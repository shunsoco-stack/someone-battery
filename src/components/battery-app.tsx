"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  Battery,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Heart,
  HeartPulse,
  History,
  Leaf,
  LoaderCircle,
  Moon,
  Plus,
  Share2,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
  WifiOff,
} from "lucide-react";
import { getAppMode } from "@/lib/firebase";
import { getDemoPost, getRandomPost } from "@/lib/posts";
import { clearHistory, readHistory, saveViewedPost } from "@/lib/history";
import { isActivePost, relativeTime, type BatteryPost } from "@/lib/battery";
import {
  analyticsAllowed,
  analyticsConfigured,
  ANALYTICS_PREFERENCE_KEY,
  recordEvent,
} from "@/lib/analytics";
import { BatteryVisual } from "./battery-visual";
import { Modal } from "./dialog";
import { PostForm } from "./post-form";

const subscribeMounted = () => () => {};
const mountedSnapshot = () => true;
const serverMounted = () => false;
const serverOnline = () => true;
const onlineSnapshot = () => navigator.onLine;
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function subscribeTheme(callback: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key === "someone-battery:theme")
      document.documentElement.dataset.theme =
        event.newValue === "light" ? "light" : "dark";
    callback();
  };
  window.addEventListener("battery-theme", callback);
  window.addEventListener("storage", sync);
  return () => {
    window.removeEventListener("battery-theme", callback);
    window.removeEventListener("storage", sync);
  };
}
const themeSnapshot = () =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";
const serverTheme = () => "dark" as const;

function reaction(percentage: number) {
  if (percentage === 0)
    return {
      heading: "ここで会えたの、奇跡です。",
      detail: "どうか、この人に充電器が見つかりますように。",
      icon: HeartPulse,
    };
  if (percentage <= 10)
    return {
      heading: "だれか、充電器を。",
      detail: "この人に、そっとコンセントの場所を教えたい。",
      icon: HeartPulse,
    };
  if (percentage <= 20)
    return {
      heading: "そろそろ、ひと休みしよう。",
      detail: "スマホも、この人も。ちょっと充電が必要かも。",
      icon: Heart,
    };
  if (percentage === 100)
    return {
      heading: "100%。もはや、発電所。",
      detail: "その計画性に、世界がスタンディングオベーション。",
      icon: Sparkles,
    };
  if (percentage >= 80)
    return {
      heading: "今日を、まだまだ楽しめそう。",
      detail: "この余裕、少しだけ分けてもらいたい。",
      icon: Leaf,
    };
  if (percentage >= 40)
    return {
      heading: "なんだか、ちょうどいい。",
      detail: "きっとこの人も、いつもどおりの一日の途中。",
      icon: Leaf,
    };
  return {
    heading: "まだ、もう少しだけ。",
    detail: "帰り道までは、持ってくれるといいな。",
    icon: Heart,
  };
}

function avatar(name: string) {
  if (name.includes("ペンギン")) return "🐧";
  if (name.includes("カピバラ")) return "♨";
  if (name.includes("ねこ") || name.includes("ネコ")) return "🐈";
  if (name.includes("うさぎ") || name.includes("ウサギ")) return "🐇";
  if (name.includes("パンダ")) return "🐼";
  return "☁";
}

export function BatteryApp() {
  const mode = getAppMode();
  const mounted = useSyncExternalStore(
    subscribeMounted,
    mountedSnapshot,
    serverMounted,
  );
  const online = useSyncExternalStore(
    subscribeOnline,
    onlineSnapshot,
    serverOnline,
  );
  const theme = useSyncExternalStore(
    subscribeTheme,
    themeSnapshot,
    serverTheme,
  );
  const [selected, setSelected] = useState<BatteryPost | null>(null);
  const [viewState, setViewState] = useState<
    "idle" | "ready" | "empty" | "error"
  >("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [postOpen, setPostOpen] = useState(false);
  const [postBusy, setPostBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [shareFallback, setShareFallback] = useState("");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now);
  const [, refreshLocal] = useState(0);
  const sentPageView = useRef(false);
  const active = selected && isActivePost(selected, now) ? selected : null;
  const expired = selected !== null && active === null && viewState === "ready";
  const history = mounted
    ? readHistory(mode).filter((post) => isActivePost(post, now))
    : [];
  const mood = active ? reaction(active.percentage) : null;
  const ReactionIcon = mood?.icon ?? Heart;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    const onStorage = () => {
      refreshLocal((value) => value + 1);
      setNow(Date.now());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onStorage);
    document.addEventListener("visibilitychange", onStorage);
    if (!sentPageView.current) {
      sentPageView.current = true;
      recordEvent("page_view", mode);
    }
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    }
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onStorage);
      document.removeEventListener("visibilitychange", onStorage);
    };
  }, [mode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showPost(post: BatteryPost, trackView = true) {
    setNow(Date.now());
    setSelected(post);
    setViewState("ready");
    setError("");
    saveViewedPost(post);
    if (trackView) recordEvent("battery_view", mode);
  }

  async function discover() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const post = await getRandomPost(selected?.id);
      if (post) showPost(post);
      else {
        setSelected(null);
        setViewState("empty");
      }
    } catch (reason) {
      setViewState("error");
      setSelected(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "読み込めませんでした。接続を確認して、もう一度お試しください。",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try {
      localStorage.setItem("someone-battery:theme", nextTheme);
    } catch {
      /* Theme still works without persistence. */
    }
    window.dispatchEvent(new Event("battery-theme"));
  }

  async function share(post?: BatteryPost) {
    if (post && !isActivePost(post)) {
      setToast("この充電は表示期限を過ぎたため、共有できません。");
      return;
    }
    const prefix =
      post?.source === "demo" || (!post && mode === "demo") ? "【デモ】" : "";
    const body = post
      ? `${prefix}${post.anonymousName}の充電は${post.percentage}%。\n`
      : `${prefix}`;
    const text = `${body}名前も知らない誰かの、いまの残量。\n誰かの充電`;
    const url = `${window.location.origin}/`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "誰かの充電", text, url });
        recordEvent("battery_share", mode);
        return;
      } catch (reason) {
        if (reason instanceof Error && reason.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      recordEvent("battery_share", mode);
      setToast("共有文とリンクをコピーしました。");
    } catch {
      setShareFallback(`${text}\n${url}`);
    }
  }

  function openPost() {
    if (!postBusy) setFormKey((value) => value + 1);
    setPostOpen(true);
  }
  function chooseSample(amount: number) {
    if (mode !== "demo") return;
    showPost(getDemoPost(amount));
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        メインコンテンツへ
      </a>
      <header className="site-header">
        <Link href="/" className="brand" aria-label="誰かの充電 ホーム">
          <span className="brand-mark">
            <Battery size={25} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <span>
            誰かの充電<span className="brand-english">someone’s battery</span>
          </span>
        </Link>
        <nav aria-label="メインナビゲーション" className="header-nav">
          <button className="nav-link" onClick={() => setAboutOpen(true)}>
            この場所について <ArrowUpRight size={13} aria-hidden="true" />
          </button>
          <a className="nav-link history-link" href="#history">
            出会った充電
          </a>
          <span className="header-divider" />
          <button
            className="icon-button theme-button"
            onClick={toggleTheme}
            aria-label={
              theme === "dark"
                ? "ライトモードに切り替える"
                : "ダークモードに切り替える"
            }
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        {!online && (
          <div className="connection-banner" role="status">
            <WifiOff size={16} />
            オフラインです。
            {mode === "demo"
              ? "端末内のデモのみ利用できます。"
              : "接続が戻るまで、新しい充電の取得・投稿はできません。"}
          </div>
        )}
        {mode === "misconfigured" && (
          <div className="configuration-banner" role="alert">
            <ShieldCheck size={20} />
            <div>
              <strong>Firebaseの設定が不完全です。</strong>
              <p>
                環境変数を確認してください。誤解を防ぐため、デモへの自動切り替えは行いません。
              </p>
            </div>
          </div>
        )}
        <section className="intro" aria-labelledby="page-heading">
          <p className="eyebrow intro-eyebrow">
            <span className="little-line" />A QUIET CONNECTION
            <span className="little-line" />
          </p>
          <h1 id="page-heading">
            名前も知らない誰かの、
            <br />
            <span>いまの残量。</span>
          </h1>
          <p className="intro-copy">
            世界のどこかで、今日を過ごす誰か。
            <br className="mobile-break" />
            その充電を、ただ眺めるだけ。
          </p>
        </section>

        <section
          className={`viewer ${active && active.percentage <= 20 ? "viewer-low" : ""} ${active?.percentage === 100 ? "viewer-full" : ""}`}
          aria-label="誰かの充電表示"
          aria-busy={busy}
        >
          <div className="viewer-topline">
            <span className="viewer-label">
              <span className="status-dot" />
              {mode === "demo"
                ? "デモモード"
                : mode === "misconfigured"
                  ? "設定を確認してください"
                  : "SOMEONE, SOMEWHERE"}
            </span>
            <span className="ephemeral-label">
              <Clock3 size={14} aria-hidden="true" />
              24時間だけの、すれ違い
            </span>
          </div>
          <div className="battery-stage">
            <BatteryVisual percentage={active?.percentage ?? null} />
            {busy && (
              <span className="loading-overlay">
                <LoaderCircle size={24} className="spin" aria-hidden="true" />
                <span>誰かのいまを、探しています</span>
              </span>
            )}
          </div>
          <div
            className="viewer-information"
            aria-live="polite"
            aria-atomic="true"
          >
            {active ? (
              <>
                <span className="sr-only">充電残量 {active.percentage}%。</span>
                <div className="anonymous-person">
                  <span className="avatar" aria-hidden="true">
                    {avatar(active.anonymousName)}
                  </span>
                  <span className="person-name">{active.anonymousName}</span>
                  <span className="time-divider">·</span>
                  <time dateTime={new Date(active.createdAt).toISOString()}>
                    {relativeTime(active.createdAt, now)}
                  </time>
                </div>
                <p className="reaction-heading">
                  <ReactionIcon size={17} aria-hidden="true" />
                  {mood?.heading}
                </p>
                <p className="reaction-detail">{mood?.detail}</p>
              </>
            ) : viewState === "empty" ? (
              <>
                <h2 className="state-heading">まだ誰も投稿していません</h2>
                <p className="reaction-detail">
                  直近24時間の投稿がありません。最初のひとつ、置いていきませんか。
                </p>
              </>
            ) : viewState === "error" ? (
              <>
                <h2 className="state-heading">いまは、つながらないみたい。</h2>
                <p className="error-message" role="alert">
                  {error}
                </p>
              </>
            ) : expired ? (
              <>
                <h2 className="state-heading">この充電は、旅を終えました。</h2>
                <p className="reaction-detail">
                  24時間が過ぎたので、次の誰かに会いにいきましょう。
                </p>
              </>
            ) : (
              <>
                <p className="initial-heading">
                  さて、誰かのいまを覗いてみよう。
                </p>
                <p className="reaction-detail">
                  ボタンの先に、ひとつの小さなつながり。
                </p>
              </>
            )}
          </div>
          <div className="viewer-bottomline">
            <span>
              <ShieldCheck size={13} aria-hidden="true" />
              {mode === "demo"
                ? "表示はすべてサンプルです。実際の投稿ではありません。"
                : "匿名・手入力の充電残量"}
            </span>
            {active && (
              <button
                className="share-inline"
                onClick={() => void share(active)}
                aria-label="この充電を共有する"
              >
                <Share2 size={15} />
                シェア
              </button>
            )}
          </div>
        </section>

        <div className="primary-actions">
          <button
            className="button button-primary discover-button"
            onClick={() => void discover()}
            disabled={
              busy || mode === "misconfigured" || (!online && mode === "live")
            }
          >
            {busy ? (
              <LoaderCircle size={20} className="spin" aria-hidden="true" />
            ) : (
              <Shuffle size={20} aria-hidden="true" />
            )}
            <span>
              {active ? "もうひとりの充電を見る" : "誰かの充電を見る"}
            </span>
            <ArrowUpRight size={19} aria-hidden="true" />
          </button>
          <button
            className="button button-secondary"
            onClick={openPost}
            disabled={mode === "misconfigured" || (!online && mode === "live")}
          >
            <Plus size={19} aria-hidden="true" />
            自分の充電を置いていく
          </button>
        </div>
        <p className="action-footnote">
          あなたのバッテリーを、自動で取得することはありません。
        </p>

        {mode === "demo" && (
          <aside className="demo-explorer" aria-label="デモの表示を試す">
            <span>
              <span className="demo-tag">DEMO</span>こんな充電にも、出会えます
            </span>
            <div>
              <button onClick={() => chooseSample(8)}>
                <HeartPulse size={14} />
                低残量 <span>8%</span>
              </button>
              <button onClick={() => chooseSample(100)}>
                <Sparkles size={14} />
                満充電 <span>100%</span>
              </button>
            </div>
          </aside>
        )}

        <section
          className="history-section"
          id="history"
          aria-labelledby="history-heading"
        >
          <div className="section-heading">
            <h2 id="history-heading">
              <History size={18} aria-hidden="true" />
              出会った充電<span className="local-chip">この端末だけ</span>
            </h2>
            {history.length > 0 && (
              <button
                className="text-button history-clear"
                onClick={() => {
                  clearHistory(mode);
                  refreshLocal((value) => value + 1);
                  setToast("この端末の表示履歴を消去しました。");
                }}
              >
                <Trash2 size={13} />
                履歴を消す
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="history-empty">
              <span className="empty-history-icon">
                <History size={22} strokeWidth={1.3} aria-hidden="true" />
              </span>
              <div>
                <p>小さな出会いは、ここに。</p>
                <span>
                  眺めた充電が、この端末にだけ残ります。24時間を過ぎると消えます。
                </span>
              </div>
              <ArrowDown
                size={17}
                className="empty-history-arrow"
                aria-hidden="true"
              />
            </div>
          ) : (
            <div className="history-grid">
              {history.slice(0, 6).map((post) => (
                <button
                  className="history-card"
                  key={post.id}
                  onClick={() => {
                    if (isActivePost(post)) showPost(post, false);
                    document
                      .querySelector(".viewer")
                      ?.scrollIntoView({
                        block: "center",
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "instant"
                          : "smooth",
                      });
                  }}
                  aria-label={`${post.anonymousName}、${post.percentage}%をもう一度見る`}
                >
                  <div className="history-card-top">
                    <BatteryVisual percentage={post.percentage} compact />
                    <strong
                      className={post.percentage <= 20 ? "low-number" : ""}
                    >
                      {post.percentage}
                      <span>%</span>
                    </strong>
                    <ChevronRight size={14} aria-hidden="true" />
                  </div>
                  <span className="history-name">{post.anonymousName}</span>
                  <span className="history-time">
                    {post.source === "demo" ? "デモ · " : ""}
                    {relativeTime(post.createdAt, now)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="quiet-promises" aria-label="この場所の約束">
          <div>
            <ShieldCheck size={20} strokeWidth={1.4} aria-hidden="true" />
            <h2>名乗らなくて、いい。</h2>
            <p>あなたのことは、あなたのままで。</p>
          </div>
          <div>
            <Clock3 size={20} strokeWidth={1.4} aria-hidden="true" />
            <h2>24時間で、さようなら。</h2>
            <p>ずっと残らない、軽やかなつながり。</p>
          </div>
          <div>
            <Heart size={20} strokeWidth={1.4} aria-hidden="true" />
            <h2>何もしない、を楽しむ。</h2>
            <p>いいねも、コメントも、ありません。</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-signature">
          <span className="tiny-battery" aria-hidden="true">
            <Battery size={19} />
          </span>
          <span>誰かの今日に、ほんの1%の関心を。</span>
        </div>
        <div className="footer-links">
          <button onClick={() => setInstallOpen(true)}>
            <Download size={14} />
            ホーム画面に追加
          </button>
          <button onClick={() => setAboutOpen(true)}>プライバシー</button><a href="/privacy">プライバシーポリシー</a>
          <a
            href="https://github.com/shunsoco-stack/someone-battery"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub <ArrowUpRight size={12} />
          </a>
        </div>
        <span className="footer-copyright">© 2026 someone’s battery</span>
      </footer>

      <Modal
        open={postOpen}
        onClose={() => setPostOpen(false)}
        title="自分の充電を投稿する"
        className="post-modal"
      >
        <PostForm
          key={formKey}
          mode={mode}
          busy={postBusy}
          online={online}
          now={now}
          onBusyChange={setPostBusy}
          onDone={() => {
            refreshLocal((value) => value + 1);
            setToast(
              mode === "demo"
                ? "デモ投稿が完了しました。実際には公開されていません。"
                : "匿名で投稿しました。",
            );
          }}
          onShare={(post) => void share(post)}
          onClose={() => setPostOpen(false)}
        />
      </Modal>

      <Modal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title="この場所について・プライバシー"
        className="about-modal"
      >
        <div className="about-content">
          <span className="modal-symbol">
            <Heart size={28} strokeWidth={1.4} aria-hidden="true" />
          </span>
          <h3>
            知らないまま、
            <br />
            ちょっとだけ気にかける。
          </h3>
          <p className="modal-description">
            名前も、居場所も、今日あったことも知らない。
            <br />
            でも、充電が8%だったら、少し心配になる。
            <br />
            そんな小さなつながりのための場所です。
          </p>
          <div className="about-rule">
            <ShieldCheck size={20} />
            <div>
              <h4>投稿に、個人情報は含めません。</h4>
              <p>
                保存するのは残量・投稿時刻・有効期限・自動生成の呼び名だけ。バッテリー情報や位置情報を端末から取得しません。
              </p>
            </div>
          </div>
          <div className="about-rule">
            <Clock3 size={20} />
            <div>
              <h4>見られるのは、24時間だけ。</h4>
              <p>
                それより前の投稿は表示しません。データベースからの物理削除は、FirebaseのTTL設定と処理状況により遅れる場合があります。
              </p>
            </div>
          </div>
          <div className="about-rule">
            <History size={20} />
            <div>
              <h4>出会いの履歴は、この端末だけに。</h4>
              <p>
                最大12件の履歴をブラウザに保存。実投稿とデモは分離し、期限が来ると履歴からも除外します。「履歴を消す」でいつでも消去できます。
              </p>
            </div>
          </div>
          <div className="about-rule">
            <CircleHelp size={20} />
            <div>
              <h4>計測するのは、操作の件数だけ。</h4>
              <p>
                Vercel
                Analyticsへ送る前に、IP・端末情報を固定の匿名値へ置き換えます。残量・呼び名・認証IDは送りません。通信サービス自体の運用ログは、各提供元の管理下にあります。
              </p>
            </div>
          </div>
          <label className="analytics-toggle">
            <span>
              <strong>匿名の利用件数を送信</strong>
              <small>{analyticsConfigured() ? "ブラウザの追跡拒否設定も尊重します。" : "現在は集計を停止しています。計測データは送信されません。"}</small>
            </span>
            <input
              type="checkbox"
              disabled={!analyticsConfigured()}
              checked={mounted && analyticsAllowed()}
              onChange={(event) => {
                try {
                  localStorage.setItem(
                    ANALYTICS_PREFERENCE_KEY,
                    event.target.checked ? "on" : "off",
                  );
                } catch {
                  setToast("このブラウザでは設定を保存できません。");
                }
                refreshLocal((value) => value + 1);
              }}
            />
          </label>
          {mode === "demo" && (
            <p className="about-demo-note">
              いまはデモモードです。架空のサンプルと端末内のデモ投稿だけを表示し、Firebaseに実投稿は作成しません。
            </p>
          )}
          <button
            className="button button-secondary full-width"
            onClick={() => setAboutOpen(false)}
          >
            わかりました <Check size={17} />
          </button>
        </div>
      </Modal>

      <Modal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        title="ホーム画面に追加する"
      >
        <div className="install-content">
          <span className="modal-symbol">
            <Download size={27} aria-hidden="true" />
          </span>
          <h3>
            ふとしたときに、
            <br />
            会いに来られるように。
          </h3>
          <p className="modal-description">
            ホーム画面に追加すると、
            <br />
            アプリのように開けます。
          </p>
          <ol className="install-steps">
            <li>
              <span>01</span>
              <p>
                ブラウザの<strong>共有メニュー</strong>、または
                <strong>メニュー（⋮）</strong>を開きます。
              </p>
            </li>
            <li>
              <span>02</span>
              <p>
                <strong>「ホーム画面に追加」</strong>または
                <strong>「アプリをインストール」</strong>を選びます。
              </p>
            </li>
            <li>
              <span>03</span>
              <p>
                デスクトップではアドレスバーのインストールアイコンも使えます。
              </p>
            </li>
          </ol>
          <p className="form-footnote">
            メニュー名や対応状況はブラウザによって異なります。新しい充電の取得・実投稿には通信が必要です。
          </p>
          <button
            className="button button-secondary full-width"
            onClick={() => setInstallOpen(false)}
          >
            閉じる
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(shareFallback)}
        onClose={() => setShareFallback("")}
        title="充電を共有する"
      >
        <div className="install-content">
          <h3>この出会いを、おすそわけ。</h3>
          <p className="modal-description">
            自動コピーが使えないため、
            <br />
            共有文を選択してコピーしてください。
          </p>
          <label className="sr-only" htmlFor="share-copy">
            共有文とリンク
          </label>
          <textarea
            id="share-copy"
            className="share-text"
            readOnly
            value={shareFallback}
            onFocus={(event) => event.target.select()}
            onCopy={() => recordEvent("battery_share", mode)}
          />
          <button
            className="button button-primary full-width"
            onClick={() => {
              document
                .querySelector<HTMLTextAreaElement>("#share-copy")
                ?.select();
              setToast("共有文を選択しました。コピーしてお使いください。");
            }}
          >
            共有文を選択する
          </button>
        </div>
      </Modal>

      <div
        className={`toast ${toast ? "is-visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <Check size={17} aria-hidden="true" />
            {toast}
          </>
        )}
      </div>
    </div>
  );
}
