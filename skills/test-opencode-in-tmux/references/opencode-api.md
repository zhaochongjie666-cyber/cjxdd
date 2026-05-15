# OpenCode Serve HTTP API Reference

Base URL: `http://localhost:${OPENCODE_PORT:-4096}`

## Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/global/health` | GET | Health check + version |
| `/session` | POST | Create session |
| `/session/:id` | GET | Get session info |
| `/session/:id` | DELETE | Delete session |
| `/session/status` | GET | List busy sessions |
| `/session/:id/prompt_async` | POST | Send async prompt (returns 204) |
| `/session/:id/message` | POST | Send streaming prompt |
| `/session/:id/message` | GET | Get messages |
| `/session/:id/diff` | GET | Get file changes |
| `/session/:id/abort` | POST | Abort session |
| `/session/:id/summarize` | POST | Compact context |
| `/session/:id/revert` | POST | Revert to message |
| `/provider` | GET | List providers/models |
| `/agent` | GET | List agents |
| `/skill` | GET | List skills |
| `/event` | GET (SSE) | Real-time events |

## Create Session

```bash
curl -X POST http://localhost:4096/session \
  -H "Content-Type: application/json" \
  -d '{"agent": "build", "model": "anthropic/claude-sonnet-4-5"}'
```

## Send Prompt

```bash
curl -X POST http://localhost:4096/session/$SESSION_ID/prompt_async \
  -H "Content-Type: application/json" \
  -d '{"content": [{"type": "text", "text": "Hello"}]}'
```

## Get Messages

```bash
curl http://localhost:4096/session/$SESSION_ID/message
```

## List Skills

```bash
curl http://localhost:4096/skill
```

## List Agents

```bash
curl http://localhost:4096/agent
```
