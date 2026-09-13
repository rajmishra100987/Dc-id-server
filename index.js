import express from "express";
import http from "http";
import fs from "fs";
import { FBClient } from "fb-messenger-e2ee";

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// State Variables
let isRunning = false;
let currentClient = null;
let stopRequested = false;

// Delay Helper Function
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Cookie String to AppState JSON Converter Helper
function convertCookieStringtoAppState(cookieStr) {
  const cookies = cookieStr.split(';');
  const appState = [];

  for (let cookie of cookies) {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      appState.push({
        key: key,
        value: value,
        domain: ".facebook.com",
        path: "/",
        hostOnly: false,
        secure: true,
        httpOnly: true
      });
    }
  }
  return appState;
}

// Web Dashboard Main Route
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FB E2EE Group & DM Auto Messenger</title>
    <style>
        body { font-family: sans-serif; background-color: #121212; color: #fff; padding: 20px; margin: 0; }
        .container { max-width: 600px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
        h2 { text-align: center; color: #0084ff; }
        label { font-weight: bold; margin-top: 15px; display: block; color: #aaa; }
        input, textarea { width: 100%; padding: 10px; margin-top: 5px; border-radius: 5px; border: 1px solid #333; background: #2a2a2a; color: #fff; box-sizing: border-box; }
        textarea { height: 100px; }
        .btn-group { display: flex; gap: 10px; margin-top: 20px; }
        button { flex: 1; padding: 12px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; font-size: 16px; }
        .btn-start { background: #0084ff; color: white; }
        .btn-stop { background: #d32f2f; color: white; }
        #logBox { margin-top: 20px; background: #000; padding: 10px; height: 150px; overflow-y: scroll; border-radius: 5px; font-family: monospace; font-size: 12px; border: 1px solid #333; }
    </style>
</head>
<body>
    <div class="container">
        <h2>FB Messenger E2EE Bot (Cookies String Supported)</h2>
        
        <form id="botForm">
            <label>Messenger Cookies String Paste Box (c_user=...; xs=...):</label>
            <textarea id="appState" placeholder="Paste c_user=...; xs=... cookies here..." required></textarea>

            <label>Target ID (DM ID ya Group Thread ID):</label>
            <input type="text" id="threadId" placeholder="e.g. 850260014837003" required>

            <label>Message Prefix (Optional):</label>
            <input type="text" id="prefix" placeholder="e.g. [DevilX] ">

            <label>Messages List (Har Line Par 1 Message):</label>
            <textarea id="messages" required>TESTING E2EE MESSAGE</textarea>

            <label>Delay (Seconds):</label>
            <input type="number" id="delay" value="30" min="5" required>

            <div class="btn-group">
                <button type="button" class="btn-start" onclick="startMessaging()">START MESSAGING</button>
                <button type="button" class="btn-stop" onclick="stopMessaging()">STOP</button>
            </div>
        </form>

        <label>Status Logs:</label>
        <div id="logBox">System Ready... Waiting for input.</div>
    </div>

    <script>
        function log(msg) {
            const logBox = document.getElementById('logBox');
            logBox.innerHTML += '<div>[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>';
            logBox.scrollTop = logBox.scrollHeight;
        }

        async function startMessaging() {
            const appState = document.getElementById('appState').value.trim();
            const threadId = document.getElementById('threadId').value.trim();
            const prefix = document.getElementById('prefix').value;
            const messages = document.getElementById('messages').value.trim().split('\\n').filter(m => m.length > 0);
            const delay = parseInt(document.getElementById('delay').value);

            if (!appState || !threadId || messages.length === 0) {
                alert('Kripya Cookies, Target ID aur Messages fill karein!');
                return;
            }

            log("Starting request sent to Render Server...");
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appState, threadId, prefix, messages, delay })
            });
            const data = await response.json();
            log(data.message);
        }

        async function stopMessaging() {
            log("Stopping request sent...");
            const response = await fetch('/api/stop', { method: 'POST' });
            const data = await response.json();
            log(data.message);
        }
    </script>
</body>
</html>
  `);
});

// Start Route
app.post("/api/start", async (req, res) => {
  if (isRunning) {
    return res.json({ message: "Bot pehle se chal raha hai!" });
  }

  const { appState, threadId, prefix, messages, delay } = req.body;

  try {
    let finalAppStateJson = appState;

    // Agar user ne JSON array ki jagah normal cookie string di hai, toh use convert karo
    if (!appState.trim().startsWith("[")) {
      console.log("Converting raw cookie string to AppState format...");
      const convertedArray = convertCookieStringtoAppState(appState);
      finalAppStateJson = JSON.stringify(convertedArray, null, 2);
    }

    fs.writeFileSync("./appstate.json", finalAppStateJson);
    if (!fs.existsSync("./session.json")) fs.writeFileSync("./session.json", "{}");

    isRunning = true;
    stopRequested = false;

    res.json({ message: "Process Start Ho Gaya Hai!" });

    console.log("Connecting FB Client via messenger.com...");
    currentClient = new FBClient({
      appStatePath: "./appstate.json",
      sessionStorePath: "./session.json",
      platform: "facebook",
    });

    const { userId } = await currentClient.connect();
    console.log(`Connected with User ID: ${userId}`);

    await currentClient.connectE2EE("./device-store.json", userId);
    console.log("E2EE Session initialized!");

    // Target ID Format Resolving Logic (DM vs Group JID Fix)
    let rawTarget = threadId.trim();
    let finalTargetId = rawTarget;

    if (!rawTarget.includes("@")) {
      finalTargetId = `${rawTarget}@msgr`;
    }

    let index = 0;

    // Messaging Loop
    while (isRunning && !stopRequested) {
      const currentMsgText = messages[index];
      const finalPayloadText = (prefix ? prefix + " " : "") + currentMsgText;

      try {
        console.log(`[SENDING] Sending message to target: ${finalTargetId}`);
        await currentClient.sendMessage({
          threadId: finalTargetId,
          text: finalPayloadText,
        });
        console.log(`[SUCCESS] Message Sent To ${finalTargetId}: "${finalPayloadText}"`);
      } catch (sendError) {
        console.error(`[SEND ERROR]: ${sendError.message}`);
        
        if (sendError.message.includes("timeout") || sendError.message.includes("IQ")) {
             console.log("[RETRYING] Trying backup attempt with raw ID format...");
             try {
                await currentClient.sendMessage({
                  threadId: rawTarget,
                  text: finalPayloadText,
                });
                console.log(`[SUCCESS RETRY] Message Sent To ${rawTarget}`);
             } catch(retryErr) {
                console.error(`[RETRY FAILED]: ${retryErr.message}`);
             }
        }
      }

      index = (index + 1) % messages.length;

      console.log(`Waiting ${delay} seconds for next message...`);
      for (let i = 0; i < delay; i++) {
        if (stopRequested) break;
        await sleep(1);
      }
    }

    console.log("Messaging Stopped.");
    isRunning = false;

  } catch (err) {
    console.error("Execution Error:", err);
    isRunning = false;
  }
});

// Stop Route
app.post("/api/stop", (req, res) => {
  if (!isRunning) {
    return res.json({ message: "Bot abhi chalu nahi hai." });
  }
  stopRequested = true;
  isRunning = false;
  res.json({ message: "Stopping command processed!" });
});

// Render Dynamic Port Bind
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server is live on Port ${PORT}`);
});

