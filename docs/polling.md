# Polling

`check_inbox` accepts `wait_ms` (0–30000). The server sleeps in 250ms slices and
returns as soon as mail appears or the deadline hits. Prefer short waits (1–5s)
inside agent loops so tools stay responsive.
