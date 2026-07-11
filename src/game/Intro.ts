// Loading intro: a burst of tracer rounds streaking upward with muzzle flashes
// along the bottom, the title fading in, then the whole overlay fades out to
// reveal the menu. Pure 2D canvas — cheap, self-contained. Click to skip.

interface Tracer {
  x: number;
  y: number;
  vy: number;
  len: number;
  w: number;
  warm: boolean;
}
interface Flash {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
}

export function playIntro(): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "intro";
    const canvas = document.createElement("canvas");
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);

    const ctx = canvas.getContext("2d")!;
    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const tracers: Tracer[] = [];
    const flashes: Flash[] = [];
    const spawn = () => {
      const x = Math.random() * W;
      const warm = Math.random() < 0.6;
      tracers.push({
        x,
        y: H + 20,
        vy: -(920 + Math.random() * 760),
        len: 60 + Math.random() * 130,
        w: 2 + Math.random() * 2.2,
        warm,
      });
      flashes.push({ x, y: H - 3, r: 0, max: 14 + Math.random() * 12, life: 1 });
    };

    for (let i = 0; i < 14; i++) spawn(); // opening volley

    const DUR = 2200;
    const start = performance.now();
    let raf = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      overlay.style.transition = "opacity 0.4s ease";
      overlay.style.opacity = "0";
      setTimeout(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        overlay.remove();
        resolve();
      }, 420);
    };
    overlay.addEventListener("click", finish);
    // Hard wall-clock fallback: some WebViews give requestAnimationFrame a
    // timestamp on a different origin than performance.now(), which can leave
    // the rAF-driven end condition never firing. This guarantees dismissal.
    setTimeout(finish, DUR + 500);

    const frame = () => {
      const el = performance.now() - start;
      if (el < 1700 && Math.random() < 0.65) {
        spawn();
        if (Math.random() < 0.5) spawn();
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0b0e14";
      ctx.fillRect(0, 0, W, H);

      // muzzle flashes
      for (const f of flashes) {
        f.r += (f.max - f.r) * 0.4;
        f.life -= 0.08;
      }
      for (const f of flashes) {
        if (f.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, f.life);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        g.addColorStop(0, "rgba(255,230,150,0.9)");
        g.addColorStop(1, "rgba(255,170,50,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // tracers
      ctx.lineCap = "round";
      for (const tr of tracers) tr.y += tr.vy / 60;
      for (const tr of tracers) {
        const col = tr.warm ? "255,241,160" : "120,210,255";
        const grad = ctx.createLinearGradient(tr.x, tr.y, tr.x, tr.y + tr.len);
        grad.addColorStop(0, `rgba(${col},1)`);
        grad.addColorStop(1, `rgba(${col},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = tr.w;
        ctx.beginPath();
        ctx.moveTo(tr.x, tr.y);
        ctx.lineTo(tr.x, tr.y + tr.len);
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},1)`;
        ctx.beginPath();
        ctx.arc(tr.x, tr.y, tr.w * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = tracers.length - 1; i >= 0; i--)
        if (tracers[i].y < -180) tracers.splice(i, 1);
      for (let i = flashes.length - 1; i >= 0; i--)
        if (flashes[i].life <= 0) flashes.splice(i, 1);

      // title
      const inA = Math.min(1, Math.max(0, (el - 300) / 500));
      const outA = el > 1700 ? Math.max(0, 1 - (el - 1700) / 500) : 1;
      const titleA = inA * outA;
      if (titleA > 0) {
        const size = Math.min(64, W * 0.11);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = titleA;
        ctx.font = `900 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.shadowColor = "rgba(55,224,166,0.7)";
        ctx.shadowBlur = 24;
        ctx.fillStyle = "#f4f8fc";
        ctx.fillText("TG SHOOTER", W / 2, H * 0.42);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = titleA * 0.9;
        ctx.font = "700 13px -apple-system, sans-serif";
        ctx.fillStyle = "#37e0a6";
        ctx.fillText("WEB3 · TON · WAGER FPS", W / 2, H * 0.42 + size * 0.6);
        ctx.globalAlpha = 1;
      }

      if (el < DUR) raf = requestAnimationFrame(frame);
      else finish();
    };
    raf = requestAnimationFrame(frame);
  });
}
