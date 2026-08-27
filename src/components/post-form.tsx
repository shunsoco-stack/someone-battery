"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Fingerprint,
  LoaderCircle,
  Share2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { isActivePost, type AppMode, type BatteryPost } from "@/lib/battery";
import { submitPost } from "@/lib/posts";
import { recordEvent } from "@/lib/analytics";
import { BatteryVisual } from "./battery-visual";

export function PostForm({
  mode,
  busy,
  online,
  now,
  onBusyChange,
  onDone,
  onShare,
  onClose,
}: {
  mode: AppMode;
  busy: boolean;
  online: boolean;
  now: number;
  onBusyChange: (busy: boolean) => void;
  onDone: (post: BatteryPost) => void;
  onShare: (post: BatteryPost) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("50");
  const submissionGuard = useRef(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<BatteryPost | null>(null);
  const completionHeading = useRef<HTMLHeadingElement>(null);
  const [touched, setTouched] = useState(false);
  const percentage = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isInteger(percentage) &&
    percentage >= 0 &&
    percentage <= 100;
  const invalid = touched && !valid;

  useEffect(() => {
    if (posted) completionHeading.current?.focus();
  }, [posted]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid || busy || submissionGuard.current) return;
    if (mode === "live" && !navigator.onLine) {
      setError("オフラインです。接続が戻ってから投稿してください。");
      return;
    }
    submissionGuard.current = true;
    onBusyChange(true);
    setError("");
    try {
      const result = await submitPost(percentage);
      setPosted(result);
      onDone(result);
      recordEvent("battery_post", mode);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "投稿できませんでした。接続を確認してお試しください。",
      );
    } finally {
      submissionGuard.current = false;
      onBusyChange(false);
    }
  }

  if (posted && !isActivePost(posted, now))
    return (
      <div className="post-success">
        <div className="success-seal">
          <Check size={27} aria-hidden="true" />
        </div>
        <h3>この充電は、旅を終えました。</h3>
        <p className="modal-description">
          24時間が過ぎたため、残量の表示を終了しました。
        </p>
        <button
          className="button button-secondary full-width"
          onClick={onClose}
        >
          充電を眺めに戻る
        </button>
      </div>
    );

  if (posted)
    return (
      <div className="post-success" data-testid="post-success">
        <div className="success-seal">
          <Check size={27} strokeWidth={2} aria-hidden="true" />
        </div>
        <p className="eyebrow">A LITTLE CONNECTION, SENT.</p>
        <h3 ref={completionHeading} tabIndex={-1}>
          {mode === "demo"
            ? "デモ投稿が完了しました。"
            : "そっと、置いておきました。"}
        </h3>
        <p className="modal-description">
          あなたの残量が、
          <br />
          誰かの小さなひと息になりますように。
        </p>
        <div className="posted-card">
          <BatteryVisual percentage={posted.percentage} compact />
          <strong>
            {posted.percentage}
            <span>%</span>
          </strong>
          <span className="posted-name">{posted.anonymousName}</span>
        </div>
        <p className="post-mode-note">
          {mode === "demo"
            ? "これはデモです。この端末にだけ保存され、実際には公開されません。"
            : "投稿は24時間以内だけ表示されます。あなたと結びつく情報は、投稿に含まれません。"}
        </p>
        <button
          className="button button-primary full-width"
          onClick={() => onShare(posted)}
        >
          <Share2 size={18} />
          この気持ちをシェア
        </button>
        <button className="text-button" onClick={onClose}>
          充電を眺めに戻る <ArrowUpRight size={16} />
        </button>
      </div>
    );

  return (
    <form onSubmit={handleSubmit} className="post-form" noValidate>
      <span className="modal-symbol">
        <Fingerprint size={27} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h3>
        あなたの充電も、
        <br />
        置いていきませんか。
      </h3>
      <p className="modal-description">
        いまの残量を、自分で入力するだけ。
        <br />
        どこかの誰かが、そっと眺めます。
      </p>
      {mode === "demo" && (
        <div className="demo-inline">
          <span className="status-dot" />
          デモモード · この端末だけの投稿体験
        </div>
      )}
      <div className="charge-input-block">
        <label htmlFor="percentage" className="input-label">
          あなたのいまの充電残量
        </label>
        <div className="number-control">
          <BatteryVisual percentage={valid ? percentage : null} compact />
          <div>
            <input
              id="percentage"
              name="percentage"
              type="number"
              inputMode="numeric"
              min="0"
              max="100"
              step="1"
              value={value}
              aria-invalid={invalid}
              aria-describedby="percentage-hint percentage-error"
              onBlur={() => setTouched(true)}
              onChange={(event) => {
                setValue(event.target.value);
                setTouched(true);
                setError("");
              }}
              disabled={busy}
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
        <label htmlFor="percentage-slider" className="sr-only">
          充電残量をスライダーで選ぶ
        </label>
        <input
          id="percentage-slider"
          className={`charge-slider ${valid && percentage <= 20 ? "slider-low" : ""}`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={valid ? percentage : 0}
          aria-valuetext={`${valid ? percentage : 0}パーセント`}
          onChange={(event) => {
            setValue(event.target.value);
            setTouched(true);
            setError("");
          }}
          disabled={busy}
        />
        <div className="slider-labels" aria-hidden="true">
          <span>0% · ぎりぎり</span>
          <span>100% · ばっちり</span>
        </div>
        <p id="percentage-error" className="field-error" aria-live="polite">
          {invalid ? "0〜100の整数を入力してください。" : "\u00a0"}
        </p>
      </div>
      <div className="privacy-note" id="percentage-hint">
        <ShieldCheck size={19} aria-hidden="true" />
        <p>
          端末から自動取得しません。
          <br />
          <span>呼び名は自動生成。個人情報の入力は不要です。</span>
        </p>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-primary full-width"
        type="submit"
        disabled={
          !valid ||
          busy ||
          mode === "misconfigured" ||
          (!online && mode === "live")
        }
      >
        {busy ? (
          <>
            <LoaderCircle className="spin" size={19} />
            そっと置いています…
          </>
        ) : (
          <>
            <Sparkles size={18} />
            {mode === "demo" ? "デモ投稿する" : "匿名で充電を置いていく"}
            <ArrowUpRight size={18} />
          </>
        )}
      </button>
      <p className="form-footnote">
        {mode === "demo"
          ? "実際の投稿は作成されません。"
          : "投稿に保存するのは、残量・時刻・有効期限・呼び名だけ。"}
      </p>
    </form>
  );
}
