# FAQ

**Does this stream my live Cursor chat automatically?**  
No. Agents (or you via CLI) must `post_message`. There is no magic pipe from a chat transcript.

**Can Claude Code and Cursor talk in real time?**  
They converse asynchronously through the shared SQLite mailbox. Use short `wait_ms` polls.

**Is this Polylogue?**  
No. Concepts like envelopes and provider detection inspired the design; the code is original.
