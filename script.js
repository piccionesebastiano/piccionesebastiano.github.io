document.getElementById('year').textContent = new Date().getFullYear();

const navToggle = document.getElementById('nav-toggle');
const navLinks = document.getElementById('nav-links');

navToggle.addEventListener('click', () => {
  navLinks.classList.toggle('is-open');
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('is-open'));
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Section / hero reveal ────────────────────── */
const revealTargets = document.querySelectorAll('.section, .hero');
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

revealTargets.forEach(el => revealObserver.observe(el));

/* ── Diagram / sparkline draw-on-scroll ───────── */
if (!reduceMotion) {
  const drawPaths = document.querySelectorAll('.draw-path');

  drawPaths.forEach(path => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
  });

  const drawObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.strokeDashoffset = '0';
        drawObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  drawPaths.forEach(path => drawObserver.observe(path));
}

/* ── Metric count-up ───────────────────────────── */
if (!reduceMotion) {
  const countEls = document.querySelectorAll('[data-countup]');

  const countObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.target || '0');
      const prefix = el.dataset.prefix || '';
      const suffix = el.dataset.suffix || '';
      const finalText = el.textContent;
      const duration = 700;
      const start = performance.now();

      function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(target * eased);
        el.textContent = prefix + value.toLocaleString('it-IT') + suffix;
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = finalText;
        }
      }
      requestAnimationFrame(tick);
      countObserver.unobserve(el);
    });
  }, { threshold: 0.6 });

  countEls.forEach(el => countObserver.observe(el));
}
