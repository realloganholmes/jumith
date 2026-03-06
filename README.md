# jumith
The agent to "Just Make It Happen"


TODO
- Integrate with OpenAI tool calls for real
  - Improve prompting to have agent interact with more tools and explore more
  - Needs to have a flow:
    - Check available tools
    - Registry search, describe, install all together if needed
    - Check available tools
    - Choose tool
    - Find facts to autofill tool
    - Get rest of facts from user
    - Call tool - dont ask for approval
    - Give result feedback to user

    - OR respond directly to natural language chat

    - OR if tool available, choose it, find facts, ask for facts, call tool, respond
  - Model keeps trying to get info it does not need like phone number, tip, etc.
    - Just needs to only know about the tool, nothing else matters
  - Try different models for better speeds and accuracies
- Registry prompt approval when downloading
- Sandboxing and secrets on registry download
- Payments (never going to happen...)