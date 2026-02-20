import sqlite3 from "sqlite3";

export const db = new sqlite3.Database("agent.db", (error) => {
  if (error) {
    console.error("Failed to connect to SQLite database", error);
  }
});
