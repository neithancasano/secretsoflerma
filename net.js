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
          safeSend({ t: "PING", ts: Date.now() });
        }, 25000);
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
          sendQueue.push(obj);
        }
      }

      function sendHello() {
        const user = window.LERMA_USER;
        const name = (user && user.displayName) ? user.displayName : "Traveler";
        // Send saved position so server can spawn us at the right spot
        const savedX = (user && user.savedX != null) ? user.savedX : null;
        const savedY = (user && user.savedY != null) ? user.savedY : null;
        safeSend({ t: "HELLO", name, savedX, savedY });
      }

      function connectNow() {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        ws = new WebSocket(wsURL());

        ws.onopen = () => {
          log("connected");
          reconnectDelayMs = 500;
          sendHello();
          flushQueue();
          startHeartbeat();
        };

        ws.onmessage = (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.t === "PONG") return;
          onMsg(msg);
        };

        ws.onerror = (e) => { log("error", e); };

        ws.onclose = (ev) => {
          log("closed", ev.code, ev.reason || "");
          stopHeartbeat();
          reconnectDelayMs = Math.min(10000, Math.floor(reconnectDelayMs * 1.6));
          reconnectTimer = setTimeout(connectNow, reconnectDelayMs);
        };
      }

      connectNow();
      return { send: safeSend };
    }
  };
})();
