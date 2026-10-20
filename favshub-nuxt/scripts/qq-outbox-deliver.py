#!/usr/bin/env python3
"""
qq-outbox-deliver.py — FavsHub QQ 机器人 outbox 投递器（宿主机 cron 运行，不打包进镜像）

架构（docs/plans/2026-09-29-dashboard-qqbot.md §B3 outbox 传输）：
  容器内的 FavsHub（server/utils/qq-notify.ts transport='outbox'）把出站通知以「一条消息一个
  JSON 文件」写入挂载卷的 spool 目录（write <name>.tmp → rename 发布，原子可见）；
  本脚本由宿主机 cron 周期性拉起：逐个读取 spool 文件 → 调用 `hermes send` 投递（官方 QQ /
  钉钉通道）→ 成功删除文件；失败则 attempts+1 回写（原子替换），超过上限或超过保留时长后丢弃；
  平台明确判定为永久性失败（无权限 / 请求不合法）的一次即丢，不做 10 次无用重试。
  目录内文件天然隔离读写竞态（消费端只碰已发布的 <id>.json，生产者从不改名已发布文件）。

hermes send 约定：`--json` 输出恒为单个 JSON 对象；投递失败也返回 exit 0（error 在 stdout JSON 里），
因此成功与否只以 JSON 的 success 字段为准。

部署（服务器，root）：
  mkdir -p <favshub-data>/qq-outbox
  cp scripts/qq-outbox-deliver.py /opt/scripts/qq-outbox-deliver.py && chmod +x /opt/scripts/qq-outbox-deliver.py
  crontab -e 追加：
    */2 * * * * FAVSHUB_OUTBOX_DIR=<favshub-data>/qq-outbox /usr/bin/python3 /opt/scripts/qq-outbox-deliver.py >> /var/log/qq-outbox-deliver.log 2>&1
  说明：并发保护由脚本内部 fcntl 锁完成（cron 前不要套 flock——flock 与 fcntl 锁同一文件会
  互相视为占用，导致空转跳过）；cron 环境变量少，显式给出 python 与脚本绝对路径。
"""
import json
import os
import subprocess
import sys
import time

# spool 目录：容器内路径 /opt/favshub/data/qq-outbox 在宿主机的对应位置（deploy skill：卷源 /www/dk_project/dk_app/data）
OUTBOX_DIR = os.environ.get("FAVSHUB_OUTBOX_DIR", "/www/dk_project/dk_app/data/qq-outbox")
HERMES = os.environ.get("HERMES_BIN", "/usr/local/bin/hermes")
MAX_ATTEMPTS = int(os.environ.get("FAVSHUB_OUTBOX_MAX_ATTEMPTS", "10"))  # 含首发共 10 次（*/2 分钟 → 最长 20 分钟窗口）
RETAIN_HOURS = float(os.environ.get("FAVSHUB_OUTBOX_RETAIN_HOURS", "12"))  # 超过 12h 仍未成功的直接丢弃（通知有时效性）
BATCH = int(os.environ.get("FAVSHUB_OUTBOX_BATCH", "20"))  # 单次最多投递条数（防 hermes 故障时无界循环）
SEND_TIMEOUT = 30

LOCK = "/tmp/qq-outbox-deliver.lock"

# 永久性失败特征：平台明确说「没有权限 / 请求本身不合法」时，重试 10 次也不会好，
# 只会白占队列并把日志刷成噪音（QQ 官方机器人群主动消息 = 40034105 无权限 就是这类）。
# 命中即丢弃，并把原因留在日志里，便于一次性定位配置问题。
PERMANENT_MARKERS = (
    "无权限", "权限不足", "not allowed", "forbidden",
    "400", "401", "403", "404", "bad request", "invalid",
    "unsupported", "not found", "chat not found", "blocked",
)


def is_permanent(detail: str) -> bool:
    d = (detail or "").lower()
    return any(m in d for m in PERMANENT_MARKERS)


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def send(target: str, text: str):
    """调 hermes send 投递；返回 (ok, detail)。--json 输出以 success 字段为准，不看退出码。"""
    try:
        proc = subprocess.run(
            [HERMES, "send", "-t", target, "--json", text],
            capture_output=True, timeout=SEND_TIMEOUT, text=True,
        )
    except subprocess.TimeoutExpired:
        return False, f"hermes send 超时（>{SEND_TIMEOUT}s）"
    except FileNotFoundError:
        return False, f"找不到 {HERMES}"
    out = (proc.stdout or "").strip()
    try:
        data = json.loads(out)
    except Exception:
        return False, f"输出非 JSON（rc={proc.returncode}）: {(out or proc.stderr)[:300]}"
    if data.get("success"):
        return True, f"message_id={str(data.get('message_id', ''))[:40]}"
    err = data.get("error") or {}
    detail = err.get("message") if isinstance(err, dict) else str(err)
    if not detail:
        detail = json.dumps(data, ensure_ascii=False)[:300]
    return False, detail[:300]


def handle(path: str, name: str, now: float) -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            entry = json.load(f)
    except Exception as e:
        os.remove(path)
        log(f"[outbox] 坏文件已删除 {name}: {e}")
        return
    target = str(entry.get("target") or "")
    text = str(entry.get("text") or "")
    # 富文本版本：钉钉群机器人（### 触发 markdown 卡片）与 QQ 官方机器人（hermes 侧嗅探后
    # 改发 msg_type=2）都支持；OneBot 等纯文本通道仍只用 text。
    markdown = str(entry.get("markdown") or "")
    if markdown and target.split(":", 1)[0].lower() in ("qqbot", "dingtalk"):
        text = markdown
    at = str(entry.get("at") or "")
    if not target or not text:
        os.remove(path)
        log(f"[outbox] 空目标/空文本，丢弃 {name}")
        return
    try:
        age_h = (now - time.mktime(time.strptime(at[:19], "%Y-%m-%dT%H:%M:%S"))) / 3600.0
    except Exception:
        age_h = 0.0
    if age_h > RETAIN_HOURS:
        os.remove(path)
        log(f"[outbox] 超龄 {age_h:.0f}h，丢弃：{target} | {text[:40]}")
        return
    ok, detail = send(target, text)
    if ok:
        os.remove(path)
        log(f"[outbox] ✓ {target} | {text[:40]}… | {detail}")
        return
    if is_permanent(detail):
        os.remove(path)
        log(f"[outbox] ✗ 永久失败（不重试），丢弃：{target} | {text[:40]} | {detail}")
        return
    attempts = int(entry.get("attempts") or 0) + 1
    entry["attempts"] = attempts
    if attempts >= MAX_ATTEMPTS:
        os.remove(path)
        log(f"[outbox] ✗ 第 {attempts} 次失败，丢弃：{target} | {text[:40]} | {detail}")
        return
    tmp = os.path.join(OUTBOX_DIR, name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    os.replace(tmp, path)  # 原地原子更新失败计数
    log(f"[outbox] keep {name}（attempts={attempts}）{target} | {detail}")


def main() -> int:
    # flock 双保险（cron 行上也有 flock -n）
    lock_fd = open(LOCK, "w")
    try:
        import fcntl
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        log("[outbox] 已有投递进程在运行，跳过本次")
        return 0
    if not os.path.isdir(OUTBOX_DIR):
        return 0  # 生产者未启用 outbox 传输，静默退出
    now = time.time()
    try:
        names = sorted(n for n in os.listdir(OUTBOX_DIR) if n.endswith(".json"))
    except OSError as e:
        log(f"[outbox] 目录不可读：{e}")
        return 1
    done = 0
    for name in names:
        if done >= BATCH:
            log(f"[outbox] 达单次上限 {BATCH}，其余等下轮")
            break
        path = os.path.join(OUTBOX_DIR, name)
        handle(path, name, now)
        done += 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
