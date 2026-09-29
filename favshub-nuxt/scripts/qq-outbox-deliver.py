#!/usr/bin/env python3
"""
qq-outbox-deliver.py — FavsHub QQ 机器人 outbox 投递器（宿主机 cron 运行，不打包进镜像）

架构（docs/plans/2026-09-29-dashboard-qqbot.md §B3 outbox 传输）：
  容器内的 FavsHub（server/utils/qq-notify.ts transport='outbox'）把出站通知以「一条消息一个
  JSON 文件」写入挂载卷的 spool 目录（write <name>.tmp → rename 发布，原子可见）；
  本脚本由宿主机 cron 周期性拉起：逐个读取 spool 文件 → 调用 `hermes send` 投递（官方 QQ /
  钉钉通道）→ 成功删除文件；失败则 attempts+1 回写（原子替换），超过上限或超过保留时长后丢弃。
  目录内文件天然隔离读写竞态（消费端只碰已发布的 <id>.json，生产者从不改名已发布文件）。

hermes send 约定：`--json` 输出恒为单个 JSON 对象；投递失败也返回 exit 0（error 在 stdout JSON 里），
因此成功与否只以 JSON 的 success 字段为准。

部署（服务器，root）：
  mkdir -p <favshub-data>/qq-outbox
  cp scripts/qq-outbox-deliver.py /opt/scripts/qq-outbox-deliver.py && chmod +x /opt/scripts/qq-outbox-deliver.py
  crontab -e 追加：
    */2 * * * * flock -n /tmp/qq-outbox-deliver.lock FAVSHUB_OUTBOX_DIR=<favshub-data>/qq-outbox /usr/bin/python3 /opt/scripts/qq-outbox-deliver.py >> /var/log/qq-outbox-deliver.log 2>&1
  （flock 防两个实例并发消费同一目录；cron 环境变量少，显式给出 python 与脚本绝对路径）
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
