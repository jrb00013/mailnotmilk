async function refresh() {
  const st = document.getElementById("status");
  chrome.runtime.sendMessage({ type: "status" }, async (local) => {
    try {
      const hub = local?.hubBase || "http://127.0.0.1:7879";
      const res = await fetch(`${hub}/api/ext/status`);
      const data = await res.json();
      st.textContent = data.connected
        ? `hub connected · preferred tab ${local?.preferredTabId ?? "auto"}`
        : `hub reachable but no recent hello · ${hub}`;
    } catch {
      st.textContent = `hub down (${local?.hubBase || "http://127.0.0.1:7879"}) — run ./run.sh`;
    }
  });
}

document.getElementById("useTab").onclick = () => {
  chrome.runtime.sendMessage({ type: "useActiveTab" }, (r) => {
    document.getElementById("status").textContent = r?.ok
      ? `using tab ${r.tabId}: ${r.title || r.url}`
      : r?.error || "failed";
  });
};

document.getElementById("refresh").onclick = refresh;
refresh();
