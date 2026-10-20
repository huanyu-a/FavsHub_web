# 通告订阅：把 FavsHub 的新通告推到我的机器人

> 读完这一页，你的 AI 助手就能做到：**站点一有新的白嫖通告（或额度变更、下架、续期），自动发到我的 QQ 群 / 单聊。**

## 这份文档解决什么

FavsHub 的白嫖通告随时在变：有人发新的、有人续期、有人下架、社区投票判定失效。
用户不想天天刷网站，想让**自己的机器人**在变化发生时收到一条消息。

**关键事实（先记住，能省掉一半踩坑）**：

> 站点**不主动推送**。站点只提供「有变化了」的数据，投递由**你（用户的 AI 助手 / Hermes）在本机完成**。

## 为什么是「你自己拉」，而不是「站点推给我」

| 方案 | 站点要不要出站 | 能不能用 | 说明 |
|---|---|---|---|
| 站点直推游客的 QQ | 要 | ✗ | QQ 机器人不在公网、站点也没有用户的机器人凭证；站点出站还需面对 SSRF、被当刷屏放大器 |
| 游客机器上跑 Hermes，定时拉 | 不要 | ✓ | 机器人在你自己机器上，站点只给数据。目标、频率、文案全你自己定 |

所以整条链路是：

```
站点事件流 (/api/token-deals/changes)
        │  你按游标拉增量（带 token 可套用过滤条件）
        ▼
   你的机器 (cron 定时跑 favshub-poll.py)
        │  逐条渲染好的文案
        ▼
   hermes send -t qqbot:<群号> --json "【上新】..."
```

站点**零出站**，游客**只有接收能力**：他不会、也不能通过订阅改动站点的任何数据。

## 选哪条路

| 路径 | 适合 | 代价 |
|---|---|---|
| **A. Feed 订阅** | Hermes（或任意阅读器）已支持订阅 feed / RSS | 零代码，但只能收「上新 / 变更 / 续期」，收不到「下架」，也无法自定义文案 |
| **B. 轮询脚本**（推荐） | 想推到指定 QQ 群 / 单聊，想按服务商过滤，想改文案 | 装一个 ~90 行脚本 + 一条 cron |
| C. 一次性查询 | 只是想看看最近有什么 | 不要建订阅，直接读列表即可 |

> **先问用户要接收目标，再动手。** 不要猜群号、不要猜 QQ 号、不要「先建个订阅再说」——
> 建了订阅却不知道往哪发，等于给用户留了一个静默失败的任务。

## 路径 A：用 Feed 订阅（零代码）

```
GET {BASE}/api/token-deals/feed.atom          # Atom，可直接填进 Hermes 的订阅
GET {BASE}/api/token-deals/feed.json          # JSON Feed 1.1（同一份数据）
```

把这个 URL 交给 Hermes 的订阅功能即可。若用户只想收某些服务商，先建订阅（见路径 B 第 1 步），
再把 `?token=<sub_token>` 加在 feed URL 后面 —— feed 会自动套用该订阅的过滤条件。

限制：feed 只包含 `online / updated / renewed`（**下架不进 feed**，已消失的内容不该继续被分发）。

## 路径 B：轮询脚本（推荐）

### 第 1 步：建订阅，拿到凭证

```bash
curl -sS -X POST {BASE}/api/deal-subscriptions \
  -H 'content-type: application/json' \
  -d '{"label":"我的 QQ 群","filters":{"providers":["某服务商"],"kinds":["online","offline","updated","renewed"]}}'
```

响应里有三个关键值：

| 字段 | 用途 |
|---|---|
| `sub_token` | **唯一凭证，只出现这一次**。相当于密码，妥善保存，不要贴到公开地方 |
| `baseline_seq` | 起步游标。**从它开始**，否则一装就把历史通告全灌进群里 |
| `subscription.changes_url` | 拉取地址模板 |

`filters` 全部可选：`kinds`（事件类型）、`providers`（服务商）、`regions`（cn/global）、`keywords`（关键词）。
不填 = 收全部。

### 第 2 步：装脚本并初始化

把下面的脚本存成 `favshub-poll.py`（放哪儿都行，下文用 `~/favshub-poll.py` 代指），然后：

```bash
python3 ~/favshub-poll.py --init --site {BASE} --target qqbot:123456789 --label "我的 QQ 群"
```

`--target` 就是 `hermes send -t` 的目标（如 `qqbot:<群号>`、`dingtalk:cid...`）。
`--init` 会建订阅、取基线、落状态文件，**不会**发历史消息。

### 第 3 步：交给 cron

```cron
*/10 * * * * python3 /你的绝对路径/favshub-poll.py >> /你的绝对路径/favshub-poll.log 2>&1
```

> cron 不做 `~` 展开，两个路径都要写全；`python3` 也建议写成 `command -v python3` 得到的绝对路径
> （cron 的 `PATH` 很窄，找不到命令时任务会静默失败）。

10 分钟一次足够（站点侧限 60 次/小时/IP）。**不要**写成 `* * * * *`：通告不是秒级数据。

### 第 4 步：自检

```bash
python3 ~/favshub-poll.py --status      # 看游标、最近投递、累计条数
python3 ~/favshub-poll.py --dry-run     # 只打印将要发什么，不真的发
```

## 脚本

```python
"""favshub-poll.py —— 把 FavsHub 新通告拉到本机，用 hermes send 投递。

  python3 favshub-poll.py --init --site https://hao.bx9y.com.cn --target qqbot:123456789
  python3 favshub-poll.py                 # 给 cron 用
  python3 favshub-poll.py --status
  python3 favshub-poll.py --dry-run
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERMES = os.environ.get("HERMES_BIN", "hermes")   # 不在 PATH 里就用 HERMES_BIN 指绝对路径
DEFAULT_STATE = os.path.expanduser("~/.favshub-sub.json")
DAILY_CAP = int(os.environ.get("FAVSHUB_POLL_DAILY_CAP", "20"))   # 每天最多推几条（防刷屏）
PAGE = 20
TIMEOUT = 20


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        log(f"[state] 读取失败（当作空状态）：{e}")
        return {}


def save_state(path, st):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def http_json(url, payload=None, timeout=TIMEOUT):
    """返回 (status, body_json_or_text)。网络异常抛 RuntimeError。"""
    data = None
    headers = {"accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = raw
        return e.code, body
    except Exception as e:
        raise RuntimeError(f"请求失败：{e}")


def hermes_send(target, text):
    """投递一条。返回 (ok, detail) —— **退出码不可信**，只认 JSON 的 success 字段。"""
    try:
        proc = subprocess.run(
            [HERMES, "send", "-t", target, "--json", text],
            capture_output=True, timeout=60, text=True,
        )
    except FileNotFoundError:
        return False, f"找不到 {HERMES}（用 HERMES_BIN 指定路径）"
    except subprocess.TimeoutExpired:
        return False, "hermes send 超时（>60s）"
    out = (proc.stdout or "").strip()
    try:
        data = json.loads(out)
    except Exception:
        return False, f"输出非 JSON（rc={proc.returncode}）：{(out or proc.stderr)[:200]}"
    if data.get("success"):
        return True, f"message_id={str(data.get('message_id', ''))[:40]}"
    err = data.get("error")
    detail = err.get("message") if isinstance(err, dict) else str(err or "")
    return False, (detail or json.dumps(data, ensure_ascii=False)[:200])


def cmd_init(args):
    st = load_state(args.state)
    body = {"label": args.label or "favshub 订阅"}
    if args.kinds:
        body["filters"] = {"kinds": [k.strip() for k in args.kinds.split(",") if k.strip()]}
    status, resp = http_json(urllib.parse.urljoin(args.site, "/api/deal-subscriptions"), body)
    if status != 200 or not isinstance(resp, dict) or not resp.get("sub_token"):
        log(f"[init] 建订阅失败（HTTP {status}）：{resp}")
        return 1
    st.update({
        "site": args.site.rstrip("/"),
        "token": resp["sub_token"],
        "target": args.target,
        "cursor": resp.get("baseline_seq", 0),
        "created_at": int(time.time()),
        "sent_total": 0,
        "sent_day": time.strftime("%Y-%m-%d"),
        "sent_today": 0,
    })
    save_state(args.state, st)
    log(f"[init] 订阅已建好：游标从 {st['cursor']} 开始，投递目标 {st['target']}")
    log(f"[init] 凭证已写入 {args.state}，请勿外传")
    return 0


def cmd_run(args):
    st = load_state(args.state)
    if not st.get("token"):
        log("[run] 还没有订阅：先跑 --init")
        return 2
    today = time.strftime("%Y-%m-%d")
    if st.get("sent_day") != today:
        st["sent_day"], st["sent_today"] = today, 0

    since = int(st.get("cursor") or 0)
    url = (f"{st['site']}/api/token-deals/changes"
           f"?token={st['token']}&since={since}&limit={PAGE}")
    try:
        status, resp = http_json(url)
    except RuntimeError as e:
        log(f"[run] {e}")
        return 1

    if status == 404:
        log("[run] 订阅不存在或已退订（凭证失效）：重新 --init")
        return 2
    if status != 200 or not isinstance(resp, dict):
        log(f"[run] 拉取失败（HTTP {status}）：{resp}")
        return 1

    events = resp.get("events") or []
    next_since = int(resp.get("next_since") or since)
    if resp.get("paused"):
        log("[run] 订阅已暂停，本轮跳过")
        return 0
    if not events:
        st["cursor"] = next_since
        save_state(args.state, st)
        return 0

    sent = 0
    for ev in events:
        text = ev.get("text") or ""
        if not text:
            continue
        if st["sent_today"] + sent >= DAILY_CAP:
            log(f"[run] 今日已推 {DAILY_CAP} 条，剩余 {len(events) - sent} 条合并成一条摘要")
            rest = len(events) - sent
            text = f"【FavsHub】还有 {rest} 条通告变化未推送，可访问 {st['site']}/tokens 查看"
            if not args.dry_run:
                ok, detail = hermes_send(st["target"], text)
                log(f"[run] 摘要投递 {'成功' if ok else '失败'}：{detail}")
            break
        if args.dry_run:
            log(f"[run] (dry-run) 将发送 #{ev.get('seq')}：{text}")
            sent += 1
            continue
        ok, detail = hermes_send(st["target"], text)
        if not ok:
            # 关键：失败**不**推进游标，下一轮重试同一条（否则这条就永久丢了）
            log(f"[run] 第 {ev.get('seq')} 条投递失败：{detail}")
            st["cursor"] = max(since, int(ev.get("seq", since)) - 1)
            save_state(args.state, st)
            return 1
        log(f"[run] 已投递 #{ev.get('seq')}：{detail}")
        sent += 1

    st["cursor"] = next_since
    st["sent_today"] = st.get("sent_today", 0) + sent
    st["sent_total"] = st.get("sent_total", 0) + sent
    st["last_run"] = int(time.time())
    save_state(args.state, st)
    log(f"[run] 完成：本轮 {sent} 条，游标 {since} → {next_since}")
    return 0


def cmd_status(args):
    st = load_state(args.state)
    if not st:
        log("[status] 还没有订阅")
        return 2
    print(json.dumps(st, ensure_ascii=False, indent=2))
    return 0


def main():
    ap = argparse.ArgumentParser(description="FavsHub 通告订阅拉取器")
    ap.add_argument("--init", action="store_true", help="创建订阅并初始化状态文件")
    ap.add_argument("--status", action="store_true", help="打印当前状态")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要发送的内容")
    ap.add_argument("--site", default="", help="站点地址，如 https://hao.bx9y.com.cn")
    ap.add_argument("--target", default="", help="hermes send 的目标，如 qqbot:123456789")
    ap.add_argument("--label", default="", help="订阅备注（后台可见）")
    ap.add_argument("--kinds", default="", help="只收某些事件：online,offline,updated,renewed")
    ap.add_argument("--state", default=DEFAULT_STATE, help="状态文件路径")
    args = ap.parse_args()

    if args.init:
        if not args.site or not args.target:
            log("--init 需要 --site 与 --target")
            return 2
        return cmd_init(args)
    if args.status:
        return cmd_status(args)
    return cmd_run(args)


if __name__ == "__main__":
    sys.exit(main())
```

要点（脚本里已经处理，读代码时别改坏）：

- **游标只在投递成功后推进**。投递失败就停在原地，下一轮重试 —— 否则那条消息永久丢失。
- **`hermes send --json` 的退出码不可信**：失败也返回 0，成功与否只看 JSON 的 `success`。
- **每日上限**（默认 20 条）：站点一下子变了 40 条时，不再逐条刷屏，改成一条摘要。

## 事件类型与文案

`/api/token-deals/changes` 返回的事件已经是**渲染好的中文句子**（`text` 字段），可以直接发：

| kind | 中文 | 触发 |
|---|---|---|
| `online` | 上新 / 恢复上架 | 管理员审核通过；撤销失效或恢复删除后重新可见 |
| `offline` | 下架 | 被删除 / 判定失效 / 到期（`reason` = `deleted` / `votes` / `manual` / `expired`） |
| `updated` | 变更 | 标题、额度、模型、链接等字段被实际改动（文案里带 `额度 100 → 200` 这样的差异） |
| `renewed` | 续期 | 有效期延长或改为永久 |
| `pinned` | 置顶 / 取消置顶 | 默认**不**订阅，需要时在 `filters.kinds` 里显式加上 |

**下架事件只带标题和原因**（不带额度、模型、领取链接）—— 内容已消失，不该继续被分发。

## 排错

| 现象 | 原因与处理 |
|---|---|
| `--status` 显示游标不动 | 拿 `changes?token=...&since=<游标>` 手跑一次：返回 `paused: true` 说明被暂停；404 说明凭证失效 |
| 拉到了但群里没消息 | 直接手跑 `hermes send -t <target> --json "测试"`，看 JSON；`success:false` 就是投递侧的问题 |
| 一次涌出几十条 | 正常（比如批量审核）。脚本有每日上限，超出会合并；嫌多就把 cron 调稀或加 `filters` |
| 收到「恢复上架」却没收到「上新」 | 该条目此前是失效状态被恢复，不是新发布 —— 语义正确 |
| 想改成只收某几家的 | `PATCH {BASE}/api/deal-subscriptions/<sub_token>`，body `{"filters":{"providers":["A","B"]}}` |

## 暂停与退订

```bash
# 暂停（保留凭证与游标，拉取返回 paused）
curl -sS -X PATCH {BASE}/api/deal-subscriptions/<sub_token> -H 'content-type: application/json' -d '{"status":"paused"}'

# 恢复
curl -sS -X PATCH {BASE}/api/deal-subscriptions/<sub_token> -H 'content-type: application/json' -d '{"status":"active"}'

# 退订（立即生效，之后该 token 一律 404）
curl -sS -X DELETE {BASE}/api/deal-subscriptions/<sub_token>
```

退订后**记得同时删掉 cron 任务**，否则它每 10 分钟空跑并打一行 404 日志。

## 红线（不可逾越）

1. **不给用户没要的推送**：没有明确的接收目标，就不要建订阅。
2. **不把 `sub_token` 写进聊天记录、公开仓库、群公告**：它等同于密码，泄露等于别人也能读这个订阅。
3. **不改用户机器上别人的 cron**：只加自己这一条，并在注释里写清用途。
4. **不提高频率对冲**：站点限 60 次/小时/IP。拉取失败先看原因，不要改成每分钟重试。
5. **站点不投递**：任何「让站点主动发消息到某地址」的实现都超出本方案，不要自行加。
6. **过滤条件在服务端生效**，但**不要**用订阅去做数据爬取（拉全量 + 过滤是客户端行为，不是分发通道）。
