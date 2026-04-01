(function () {
  function wsURL() {
    const proto = (location.protocol === "https:") ? "wss://" : "ws://";
    return proto + location.host + "/secretsoflerma/ws";
  }

  window.LERMA_NET = {
    connect(onMsg) {
      let ws = null;
      let heartbeatTimer = null;
      let reconnectTimer = null;
      let reconnectDelayMs = 500;
      const sendQueue = [];

      function log(...a) { console.log("[LERMA_WS]", ...a); }

      function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          // app-level ping; keeps proxies/CDNs from idling us out
          safeSend({ t: "PING", ts: Date.now() });
        }, 25000); // 25s is a good default
      }

      function stopHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      function flushQueue() {
        while (sendQueue.length && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(sendQueue.shift()));
        }
      }

      function safeSend(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(obj));
        } else {
          // queue while disconnected; prevents “silent nothing happens”
          sendQueue.push(obj);
        }
      }

      function connectNow() {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

        ws = new WebSocket(wsURL());

        ws.onopen = () => {
          log("connected");
          reconnectDelayMs = 500; // reset backoff
          const name = (localStorage.getItem("lerma_name") || "jen").slice(0, 20);
          safeSend({ t: "HELLO", name });
          flushQueue();
          startHeartbeat();
        };

        ws.onmessage = (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }

          // optional: handle pong
          if (msg.t === "PONG") return;

          onMsg(msg);
        };

        ws.onerror = (e) => {
          log("error", e);
        };

        ws.onclose = (ev) => {
          log("closed", ev.code, ev.reason || "");
          stopHeartbeat();

          // reconnect with backoff (up to 10s)
          reconnectDelayMs = Math.min(10000, Math.floor(reconnectDelayMs * 1.6));
          reconnectTimer = setTimeout(connectNow, reconnectDelayMs);
        };
      }

      connectNow();

      return { send: safeSend };
    }
  };
})();
