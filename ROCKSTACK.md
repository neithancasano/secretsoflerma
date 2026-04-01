# 🪨 RockStack

**One infrastructure philosophy. Two stacks. Zero chaos.**

> RockStack is the dev workflow system built for neithan.rocks and jeni.rocks.
> It connects a live AWS Lightsail WordPress server to GitHub and Claude AI —
> so every project has a home, every change is tracked, and your AI always has context.

---

## The Stacks

| Stack | Owner | Domain | Repo |
|---|---|---|---|
| RockStack One | Neithan | neithan.rocks | github.com/neithancasano |
| RockStack Two | Jen | jeni.rocks | TBD |

---

## The Philosophy

- **Every project has a home** → GitHub repo, clean folder structure
- **One workflow for all edits** → VS Code Remote SSH, no more FileZilla
- **Always version controlled** → Git on the server, every change committed
- **AI always has context** → GitHub MCP connected to Claude, no copy-pasting
- **Both stacks follow the same rules** → Neithan and Jen speak the same dev language

---

## RockStack One — Setup Playbook

### Prerequisites
- AWS Lightsail WordPress instance (Bitnami)
- GitHub account
- Windows PC
- Claude Desktop app

---

### Step 1 — Git on the Server

**1.1 SSH into your Lightsail instance**
```bash
ssh -i /path/to/your-key.pem bitnami@your-lightsail-ip
```

**1.2 Install Git**
```bash
sudo apt-get update && sudo apt-get install git -y
```

**1.3 Navigate to your project folder**
```bash
cd /opt/bitnami/wordpress/your-project-name
```

**1.4 Initialize Git repo**
```bash
git init
git branch -m main
```

**1.5 Set your Git identity**
```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

**1.6 Create a new repo on GitHub**
- Go to github.com → + → New repository
- Name it after your project
- Do NOT initialize with README
- Click Create repository

**1.7 Link local repo to GitHub**
```bash
git remote add origin https://github.com/yourusername/your-project.git
```

**1.8 First commit and push**
```bash
git add .
git commit -m "RockStack One — initial commit 🪨"
git push -u origin master
```

> ⚠️ GitHub no longer accepts passwords. Use a Personal Access Token (PAT) as your password.
> Generate one at: GitHub → Settings → Developer Settings → Tokens (classic)
> Scopes needed: repo

---

### Step 2 — VS Code Remote SSH

**2.1 Install VS Code**
- Download from code.visualstudio.com
- During install, check "Add to PATH" and "Open with Code"

**2.2 Install the Remote - SSH extension**
- Open VS Code → Extensions (Ctrl+Shift+X)
- Search: Remote - SSH (by Microsoft)
- Click Install

**2.3 Configure SSH connection**
- Press Ctrl+Shift+P → Remote-SSH: Open SSH Configuration File
- Select C:\Users\YourName\.ssh\config
- Paste this config:

```
Host RockStackOne
    HostName YOUR_LIGHTSAIL_IP
    User bitnami
    IdentityFile C:\Users\YourName\.ssh\your-key.pem
```

**2.4 Connect**
- Press Ctrl+Shift+P → Remote-SSH: Connect to Host
- Select RockStackOne
- Bottom left corner should show: SSH: RockStackOne ✅

**2.5 Open your project folder**
- Press Ctrl+K then Ctrl+O
- Type: /opt/bitnami/wordpress/your-project-name
- Your files appear in the sidebar — edits are live instantly on the server

---

### Step 3 — GitHub MCP + Claude

**3.1 Make sure Node.js is installed on your Windows PC**
```bash
node --version
```
If not installed, download from nodejs.org

**3.2 Generate a GitHub PAT for MCP**
- GitHub → Settings → Developer Settings → Tokens (classic)
- Name: RockStack MCP
- Scopes: repo, read:org
- Copy the token immediately

**3.3 Edit Claude Desktop config**
- Navigate to: C:\Users\YourName\AppData\Roaming\Claude\claude_desktop_config.json
- Add the mcpServers block (keep existing preferences):

```json
{
  "preferences": {
    ...your existing preferences...
  },
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

**3.4 Restart Claude Desktop**
- Fully quit and reopen
- Click + → Connectors → GitHub should appear with toggle ON ✅

---

## Daily Workflow

After editing any file in VS Code, open the terminal (Ctrl+`) and run:

```bash
git add .
git commit -m "describe what you changed"
git push
```

When G pushes code directly via MCP, pull it down to your server:

```bash
git pull origin master
```

Claude can now read your latest code in any conversation. No copy-pasting. No lost context. 🪨

---

## Sync Cheatsheet

| Situation | Command |
|---|---|
| Check if everything is in sync | `git status` |
| See last 5 commits | `git log --oneline -5` |
| Discard changes to one file | `git checkout -- filename.js` |
| Discard ALL local changes | `git reset --hard origin/master` |
| Pull latest from GitHub | `git pull origin master` |

---

## Server Management (Node.js + pm2)

### First-time pm2 setup for a new server project

```bash
cd /opt/bitnami/game-servers/your-project
pm2 start index.js --name your-project-name
pm2 save
pm2 startup
# Copy and run the command pm2 startup gives you
```

### Make pm2 survive reboots permanently
```bash
sudo env PATH=$PATH:/usr/local/node/bin /usr/local/node/lib/node_modules/pm2/bin/pm2 startup systemd -u bitnami --hp /home/bitnami
pm2 save
```

### If a systemd service conflicts with pm2 (port already in use)
```bash
# Stop and permanently delete the conflicting service
sudo systemctl stop your-service-name
sudo systemctl disable your-service-name
sudo rm /etc/systemd/system/your-service-name.service
sudo systemctl daemon-reload

# Then restart pm2
pm2 restart your-project-name
```

### Daily pm2 commands

| Command | What it does |
|---|---|
| `pm2 list` | See all running processes + restart count |
| `pm2 restart your-project` | Restart your server |
| `pm2 logs your-project` | See live logs |
| `pm2 logs your-project --lines 30` | See last 30 log lines |
| `pm2 stop your-project` | Stop the server |
| `pm2 monit` | Live CPU/memory dashboard |

### Warning signs to watch for
- **↺ restart count > 10** in `pm2 list` → server is crash-looping, check logs immediately
- **CPU at 100%** in Lightsail metrics → likely a restart loop or runaway process
- **EADDRINUSE error** in logs → another process is holding the port, find and kill it:

```bash
sudo ss -tlnp | grep YOUR_PORT
sudo kill -9 THE_PID
pm2 restart your-project
```

### Add a Static IP (do this once — free on Lightsail!)
- Lightsail console → Networking → Create static IP → Attach to instance
- Your IP never changes again — no need to update SSH config after reboots

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `git: command not found` | Run `sudo apt-get install git -y` |
| GitHub push asks for password | Use your Personal Access Token, not your password |
| VS Code can't connect | Check your .pem file path in SSH config. If IP changed, update HostName |
| Claude can't see repo | Make sure GitHub toggle is ON in Connectors menu |
| `bullseye-backports` error on apt | Safe to ignore, main repos still work |
| Port already in use (EADDRINUSE) | `sudo ss -tlnp | grep PORT` → kill the PID → `pm2 restart` |
| CPU spike to 100% | Check `pm2 list` for high restart count. Check `sudo ss -tlnp` for duplicate processes |
| pm2 list is empty after reboot | Run `pm2 startup` and `pm2 save` again |

---

*Built by Neithan & G — April 2026* 🪨
