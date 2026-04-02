(function () {
  function wsURL() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host + '/secretsoflerma/ws';
  }

  window.LERMA_NET = {
    connect(onMsg) {
      let ws=null, heartbeatTimer=null, reconnectTimer=null, reconnectDelayMs=500;
      const sendQueue=[];

      function startHeartbeat(){stopHeartbeat();heartbeatTimer=setInterval(()=>safeSend({t:'PING',ts:Date.now()}),25000);}
      function stopHeartbeat(){if(heartbeatTimer)clearInterval(heartbeatTimer);heartbeatTimer=null;}
      function flushQueue(){while(sendQueue.length&&ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(sendQueue.shift()));}
      function safeSend(obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));else sendQueue.push(obj);}

      function sendHello(){
        const user=window.LERMA_USER||{};
        safeSend({
          t:'HELLO',
          name:user.displayName||'Traveler',
          savedX:user.savedX??null,
          savedY:user.savedY??null,
          savedZone:user.savedZone||null,
          stats:user.savedStats||null,
          respawnZone:user.respawnZone||null,
          respawnX:user.respawnX??null,
          respawnY:user.respawnY??null,
        });
      }

      function connectNow(){
        if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
        ws=new WebSocket(wsURL());
        ws.onopen=()=>{console.log('[LERMA_WS] connected');reconnectDelayMs=500;sendHello();flushQueue();startHeartbeat();};
        ws.onmessage=(ev)=>{let msg;try{msg=JSON.parse(ev.data);}catch{return;}if(msg.t==='PONG')return;onMsg(msg);};
        ws.onerror=(e)=>console.log('[LERMA_WS] error',e);
        ws.onclose=(ev)=>{console.log('[LERMA_WS] closed',ev.code);stopHeartbeat();reconnectDelayMs=Math.min(10000,Math.floor(reconnectDelayMs*1.6));reconnectTimer=setTimeout(connectNow,reconnectDelayMs);};
      }
      connectNow();
      return{send:safeSend};
    }
  };
})();
