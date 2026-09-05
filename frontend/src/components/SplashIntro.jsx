import { useEffect, useState } from "react";

/**
 * Boot animation. Two shield halves fly in diagonally (one from the upper
 * left, one from the lower right), collide and fuse into a single shield.
 * The shield then eases left while the "LabSentinel" wordmark unfurls to its
 * right. The whole lockup holds at center, then fades out to reveal the
 * dashboard. Click anywhere to skip. Honors prefers-reduced-motion.
 */
function ShieldBody() {
  // one full shield with a heartbeat pulse inside; rendered twice, each half
  // clipped, so the two pieces can be flown in independently and then overlap.
  return (
    <>
      <path
        d="M50 8 L90 22 L90 58 C90 88 72 104 50 114 C28 104 10 88 10 58 L10 22 Z"
        fill="url(#lsGrad)"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1.5"
      />
      <path
        d="M50 8 L90 22 L90 58 C90 88 72 104 50 114 C28 104 10 88 10 58 L10 22 Z"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="3"
        transform="scale(0.86) translate(8.1 9.5)"
      />
      <polyline
        points="24,63 37,63 43,49 51,80 59,55 65,63 78,63"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export default function SplashIntro({ onDone }) {
  const [phase, setPhase] = useState("run"); // run -> out

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const holdEnd = reduce ? 900 : 2500; // when the fade-out begins
    const gone = reduce ? 1300 : 3100; // when we unmount and show the dashboard

    const t1 = setTimeout(() => setPhase("out"), holdEnd);
    const t2 = setTimeout(() => onDone && onDone(), gone);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <div
      className={`intro-overlay ${phase === "out" ? "intro-out" : ""}`}
      onClick={() => onDone && onDone()}
      role="presentation"
    >
      <div className="intro-lockup">
        <div className="intro-shield">
          <svg className="intro-half intro-half--l" viewBox="0 0 100 120" aria-hidden="true">
            <defs>
              <linearGradient id="lsGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#34d399" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
              <clipPath id="lsClipL">
                <rect x="-2" y="0" width="52" height="120" />
              </clipPath>
            </defs>
            <g clipPath="url(#lsClipL)">
              <ShieldBody />
            </g>
          </svg>
          <svg className="intro-half intro-half--r" viewBox="0 0 100 120" aria-hidden="true">
            <defs>
              <clipPath id="lsClipR">
                <rect x="50" y="0" width="52" height="120" />
              </clipPath>
            </defs>
            <g clipPath="url(#lsClipR)">
              <ShieldBody />
            </g>
          </svg>
          <span className="intro-seam" />
        </div>
        <span className="intro-name">LabSentinel</span>
      </div>
    </div>
  );
}
