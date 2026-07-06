/* jumith web UI */
(() => {
  "use strict";

  const els = {
    connStatus: document.getElementById("conn-status"),
    chatScroll: document.getElementById("chat-scroll"),
    chatMessages: document.getElementById("chat-messages"),
    chatEmpty: document.getElementById("chat-empty"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    chatSend: document.getElementById("chat-send"),
    clearChat: document.getElementById("clear-chat"),
    toolsList: document.getElementById("tools-list"),
    registryForm: document.getElementById("registry-search-form"),
    registrySearch: document.getElementById("registry-search"),
    registryResults: document.getElementById("registry-results"),
    factsList: document.getElementById("facts-list"),
    factAddForm: document.getElementById("fact-add-form"),
    factKey: document.getElementById("fact-key"),
    factValue: document.getElementById("fact-value"),
    factsClear: document.getElementById("facts-clear"),
    vaultSource: document.getElementById("vault-source"),
    paymentStatus: document.getElementById("payment-status"),
    payNumber: document.getElementById("pay-number"),
    payExp: document.getElementById("pay-exp"),
    payCvv: document.getElementById("pay-cvv"),
    payZip: document.getElementById("pay-zip"),
    paySave: document.getElementById("pay-save"),
    payClear: document.getElementById("pay-clear"),
    toolSecrets: document.getElementById("tool-secrets"),
    secretsClearAll: document.getElementById("secrets-clear-all"),
    activityList: document.getElementById("activity-list"),
  };

  let ws = null;
  let thinkingEl = null;
  let sending = false;

  // ------------------------------------------------------------- utilities

  async function api(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function post(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function scrollToBottom() {
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
  }

  function hideEmpty() {
    if (els.chatEmpty) els.chatEmpty.style.display = "none";
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  // ------------------------------------------------------------------ chat

  function addMessage(role, content) {
    hideEmpty();
    const bubble = el("div", `msg msg-${role}`, content);
    els.chatMessages.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function addActivity(icon, label, detail, isError) {
    hideEmpty();
    const line = el("div", "activity-line" + (isError ? " act-error" : ""));
    line.appendChild(el("span", "act-icon", icon));
    line.appendChild(el("span", "act-label", label));
    if (detail) line.appendChild(el("span", "act-detail", truncate(detail, 90)));
    els.chatMessages.appendChild(line);
    scrollToBottom();
  }

  function showThinking() {
    removeThinking();
    thinkingEl = el("div", "thinking");
    for (let i = 0; i < 3; i++) thinkingEl.appendChild(el("span"));
    els.chatMessages.appendChild(thinkingEl);
    scrollToBottom();
  }

  function removeThinking() {
    if (thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  function setSending(value) {
    sending = value;
    els.chatSend.disabled = value;
  }

  function sendChat(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage("error", "Not connected to the agent. Retrying…");
      return;
    }
    addMessage("user", text);
    showThinking();
    setSending(true);
    ws.send(JSON.stringify({ type: "chat", id: String(Date.now()), text }));
  }

  els.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text || sending) return;
    els.chatInput.value = "";
    autosize();
    sendChat(text);
  });

  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.chatForm.requestSubmit();
    }
  });

  function autosize() {
    els.chatInput.style.height = "auto";
    els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 140) + "px";
  }
  els.chatInput.addEventListener("input", autosize);

  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      els.chatInput.value = button.textContent;
      els.chatInput.focus();
      autosize();
    });
  });

  els.clearChat.addEventListener("click", async () => {
    if (!confirm("Clear the entire chat history?")) return;
    await post("/api/history/clear");
    els.chatMessages.innerHTML = "";
    els.chatMessages.appendChild(els.chatEmpty);
    els.chatEmpty.style.display = "";
  });

  // -------------------------------------------------------- prompt cards

  function addApprovalCard(id, message) {
    hideEmpty();
    const card = el("div", "prompt-card");
    card.appendChild(el("h4", null, "Approval needed"));
    card.appendChild(el("p", null, message));
    const actions = el("div", "prompt-actions");
    const approve = el("button", "btn btn-success btn-sm", "Approve");
    const deny = el("button", "btn btn-ghost btn-sm", "Deny");
    actions.appendChild(approve);
    actions.appendChild(deny);
    card.appendChild(actions);
    els.chatMessages.appendChild(card);
    scrollToBottom();

    const respond = (approved) => {
      ws.send(JSON.stringify({ type: "prompt_response", id, value: approved }));
      actions.remove();
      card.appendChild(
        el("div", "prompt-resolved", approved ? "✓ Approved" : "✗ Denied")
      );
    };
    approve.addEventListener("click", () => respond(true));
    deny.addEventListener("click", () => respond(false));
  }

  function addSecretCard(id, secretName, message, shared) {
    hideEmpty();
    const card = el("div", "prompt-card secret-card");
    card.appendChild(el("h4", null, "Vault: secret needed"));
    card.appendChild(
      el(
        "p",
        null,
        (shared
          ? `Enter ${secretName}. It is stored encrypted in your vault and reused by payment-capable tools you approve.`
          : message) + " The agent never sees this value."
      )
    );
    const input = el("input");
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = secretName;
    card.appendChild(input);
    const actions = el("div", "prompt-actions");
    const save = el("button", "btn btn-primary btn-sm", "Save to vault");
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    actions.appendChild(save);
    actions.appendChild(cancel);
    card.appendChild(actions);
    els.chatMessages.appendChild(card);
    scrollToBottom();
    input.focus();

    const respond = (value) => {
      ws.send(JSON.stringify({ type: "prompt_response", id, value }));
      input.remove();
      actions.remove();
      card.appendChild(
        el("div", "prompt-resolved", value ? "✓ Saved to vault" : "✗ Skipped")
      );
      loadSecrets().catch(() => {});
    };
    save.addEventListener("click", () => respond(input.value || null));
    cancel.addEventListener("click", () => respond(null));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") respond(input.value || null);
    });
  }

  // ------------------------------------------------------------ websocket

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener("open", () => {
      els.connStatus.textContent = "online";
      els.connStatus.className = "chip chip-ok";
    });

    ws.addEventListener("close", () => {
      els.connStatus.textContent = "offline";
      els.connStatus.className = "chip chip-err";
      setTimeout(connect, 2000);
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleServerMessage(msg);
    });
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case "chat_result":
        removeThinking();
        setSending(false);
        addMessage("assistant", msg.reply);
        refreshSidebarSoft();
        break;
      case "chat_error":
        removeThinking();
        setSending(false);
        addMessage("error", msg.error);
        break;
      case "approval_request":
        addApprovalCard(msg.id, msg.message);
        break;
      case "secret_request":
        addSecretCard(msg.id, msg.secretName, msg.message, msg.shared);
        break;
      case "agent_event":
        handleAgentEvent(msg.event);
        break;
    }
  }

  function handleAgentEvent(event) {
    switch (event.type) {
      case "tool_call":
        addActivity("🔧", event.toolName, summarizeInput(event.input));
        break;
      case "tool_result":
        if (event.status === "success") {
          addActivity("✅", `${event.toolName} done`, `${event.durationMs}ms`);
        } else if (event.status === "denied") {
          addActivity("🚫", `${event.toolName} denied by you`);
        } else {
          addActivity("⚠️", `${event.toolName} failed`, event.output, true);
        }
        break;
      case "memory_lookup":
        addActivity(
          "🧠",
          `memory: ${event.query.join(", ")}`,
          `${event.found} found`
        );
        break;
      case "facts_saved":
        addActivity("💾", `remembered: ${event.keys.join(", ")}`);
        break;
      case "status":
        addActivity("ℹ️", event.message);
        break;
    }
  }

  function summarizeInput(input) {
    if (input === null || input === undefined) return "";
    try {
      return typeof input === "string" ? input : JSON.stringify(input);
    } catch {
      return "";
    }
  }

  // -------------------------------------------------------------- sidebar

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-body").forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
      refreshTab(tab.dataset.tab);
    });
  });

  document.querySelectorAll("[data-refresh]").forEach((button) => {
    button.addEventListener("click", () => refreshTab(button.dataset.refresh));
  });

  function refreshTab(name) {
    const loaders = {
      tools: loadTools,
      memory: loadFacts,
      vault: loadSecrets,
      activity: loadActivity,
    };
    if (loaders[name]) loaders[name]().catch(console.error);
  }

  function refreshSidebarSoft() {
    loadTools().catch(() => {});
    loadFacts().catch(() => {});
  }

  // tools

  async function loadTools() {
    const { tools } = await api("/api/tools");
    els.toolsList.innerHTML = "";
    if (tools.length === 0) {
      els.toolsList.appendChild(el("div", "empty-note", "No tools installed."));
      return;
    }
    for (const tool of tools) {
      const card = el("div", "card");
      card.appendChild(el("h4", null, tool.name));
      const badges = el("div", "card-badges");
      badges.appendChild(
        el("span", "badge" + (tool.source === "registry" ? " badge-accent" : ""), tool.source)
      );
      if (tool.version) badges.appendChild(el("span", "badge", `v${tool.version}`));
      if (tool.requiresApproval === true) badges.appendChild(el("span", "badge badge-warn", "needs approval"));
      if (tool.requiresApproval === "dynamic") badges.appendChild(el("span", "badge badge-warn", "approval: per action"));
      if ((tool.requiredSecrets || []).length > 0) badges.appendChild(el("span", "badge badge-accent", "uses vault"));
      card.appendChild(badges);
      card.appendChild(el("p", "desc", truncate(tool.description, 220)));
      if (tool.source === "registry" && tool.id) {
        const actions = el("div", "card-actions");
        const remove = el("button", "btn btn-ghost btn-sm btn-danger-text", "Remove");
        remove.addEventListener("click", async () => {
          await post("/api/tools/remove", { id: tool.id });
          loadTools();
        });
        actions.appendChild(remove);
        card.appendChild(actions);
      }
      els.toolsList.appendChild(card);
    }
  }

  // registry

  els.registryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = els.registrySearch.value.trim();
    if (!query) return;
    els.registryResults.innerHTML = "";
    els.registryResults.appendChild(el("div", "empty-note", "Searching…"));
    try {
      const { results } = await api(`/api/registry/search?q=${encodeURIComponent(query)}`);
      els.registryResults.innerHTML = "";
      if (results.length === 0) {
        els.registryResults.appendChild(el("div", "empty-note", "No tools found."));
        return;
      }
      for (const item of results) {
        const card = el("div", "card");
        card.appendChild(el("h4", null, item.name));
        const badges = el("div", "card-badges");
        badges.appendChild(el("span", "badge", `v${item.version}`));
        if (item.requiresApproval) badges.appendChild(el("span", "badge badge-warn", "needs approval"));
        if ((item.requiredSecrets || []).length > 0) badges.appendChild(el("span", "badge badge-accent", "uses vault"));
        card.appendChild(badges);
        card.appendChild(el("p", "desc", truncate(item.summary || "", 200)));
        const actions = el("div", "card-actions");
        const install = el("button", "btn btn-primary btn-sm", "Install");
        install.addEventListener("click", async () => {
          install.disabled = true;
          install.textContent = "Installing…";
          try {
            await post("/api/tools/install", { id: item.id });
            install.textContent = "Installed ✓";
            loadTools();
          } catch (error) {
            install.textContent = "Failed";
            alert(error.message);
          }
        });
        actions.appendChild(install);
        card.appendChild(actions);
        els.registryResults.appendChild(card);
      }
    } catch (error) {
      els.registryResults.innerHTML = "";
      els.registryResults.appendChild(el("div", "empty-note", error.message));
    }
  });

  // memory / facts

  async function loadFacts() {
    const { facts } = await api("/api/facts");
    els.factsList.innerHTML = "";
    if (facts.length === 0) {
      els.factsList.appendChild(
        el("div", "empty-note", "Nothing remembered yet. Just tell the agent about yourself in chat.")
      );
      return;
    }
    for (const fact of facts) {
      const row = el("div", "fact-row");
      row.appendChild(el("span", "fact-key", fact.key));
      row.appendChild(el("span", "fact-value", fact.value));
      const del = el("button", "fact-del", "✕");
      del.title = "Forget this fact";
      del.addEventListener("click", async () => {
        await post("/api/facts/delete", { key: fact.key });
        loadFacts();
      });
      row.appendChild(del);
      els.factsList.appendChild(row);
    }
  }

  els.factAddForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = els.factKey.value.trim();
    const value = els.factValue.value.trim();
    if (!key || !value) return;
    await post("/api/facts", { key, value });
    els.factKey.value = "";
    els.factValue.value = "";
    loadFacts();
  });

  els.factsClear.addEventListener("click", async () => {
    if (!confirm("Forget everything the agent knows about you?")) return;
    await post("/api/facts/clear");
    loadFacts();
  });

  // vault / secrets

  async function loadSecrets() {
    const data = await api("/api/secrets");
    els.vaultSource.textContent = `key: ${data.vaultKeySource || "unknown"}`;

    els.paymentStatus.innerHTML = "";
    const allSet = data.payment.every((s) => s.set);
    const anySet = data.payment.some((s) => s.set);
    els.paymentStatus.appendChild(
      el(
        "span",
        "badge " + (allSet ? "badge-ok" : anySet ? "badge-warn" : ""),
        allSet ? "card on file ✓" : anySet ? "card partially saved" : "no card saved"
      )
    );

    els.toolSecrets.innerHTML = "";
    for (const group of data.toolSecrets) {
      const scoped = group.secrets.filter((s) => !s.shared);
      if (scoped.length === 0) continue;
      const card = el("div", "card");
      card.appendChild(el("h4", null, group.tool));
      for (const secret of scoped) {
        const row = el("div", "secret-row");
        row.appendChild(el("span", "secret-name", secret.name));
        const right = el("div");
        right.appendChild(
          el("span", "badge " + (secret.set ? "badge-ok" : "badge-warn"), secret.set ? "set" : "missing")
        );
        if (secret.set) {
          const clear = el("button", "btn btn-ghost btn-sm btn-danger-text", "clear");
          clear.style.marginLeft = "6px";
          clear.addEventListener("click", async () => {
            await post("/api/secrets/delete", { key: secret.key });
            loadSecrets();
          });
          right.appendChild(clear);
        }
        row.appendChild(right);
        card.appendChild(row);
      }
      els.toolSecrets.appendChild(card);
    }
  }

  els.paySave.addEventListener("click", async () => {
    const fields = [
      ["payment.card_number", els.payNumber.value],
      ["payment.card_expiration", els.payExp.value],
      ["payment.card_cvv", els.payCvv.value],
      ["payment.card_zip", els.payZip.value],
    ];
    if (fields.some(([, value]) => !value.trim())) {
      alert("Fill in all four card fields.");
      return;
    }
    els.paySave.disabled = true;
    try {
      for (const [secretName, value] of fields) {
        await post("/api/secrets/set", { toolName: "", secretName, value });
      }
      els.payNumber.value = els.payExp.value = els.payCvv.value = els.payZip.value = "";
      loadSecrets();
    } finally {
      els.paySave.disabled = false;
    }
  });

  els.payClear.addEventListener("click", async () => {
    if (!confirm("Remove the saved payment card from the vault?")) return;
    for (const name of [
      "payment.card_number",
      "payment.card_expiration",
      "payment.card_cvv",
      "payment.card_zip",
    ]) {
      await post("/api/secrets/delete", { key: `shared-${name}` });
    }
    loadSecrets();
  });

  els.secretsClearAll.addEventListener("click", async () => {
    if (!confirm("Clear EVERY secret in the vault, including the payment card?")) return;
    await post("/api/secrets/clear");
    loadSecrets();
  });

  // activity

  async function loadActivity() {
    const { logs } = await api("/api/logs?limit=50");
    els.activityList.innerHTML = "";
    if (logs.length === 0) {
      els.activityList.appendChild(el("div", "empty-note", "No tool activity yet."));
      return;
    }
    for (const log of logs) {
      const row = el("div", "log-row");
      const head = el("div", "log-head");
      head.appendChild(el("span", "log-tool", log.toolName));
      const right = el("span", `log-status-${log.status}`, log.status);
      head.appendChild(right);
      row.appendChild(head);
      row.appendChild(el("div", "log-detail", truncate(`in: ${log.input}`, 160)));
      row.appendChild(el("div", "log-detail", truncate(`out: ${log.output}`, 160)));
      els.activityList.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- boot

  async function loadHistory() {
    try {
      const { messages } = await api("/api/history?limit=100");
      for (const message of messages) {
        if (message.role === "user" || message.role === "assistant") {
          addMessage(message.role, message.content);
        }
      }
      if (messages.length === 0) {
        els.chatEmpty.style.display = "";
      }
    } catch {
      /* server not ready yet */
    }
  }

  connect();
  loadHistory();
  loadTools().catch(() => {});
  autosize();
})();
