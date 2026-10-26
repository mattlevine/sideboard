(() => {
  const header = document.querySelector('header.nav');
  const btn = header?.querySelector('.nav-burger');
  const links = header?.querySelector('.nav-links');
  if (!header || !btn || !links) return;

  const setOpen = (open) => {
    header.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };

  btn.addEventListener('click', () => {
    setOpen(!header.classList.contains('nav-open'));
  });

  links.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', (event) => {
    if (!header.classList.contains('nav-open')) return;
    if (event.target instanceof Node && header.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !header.classList.contains('nav-open')) return;
    setOpen(false);
    btn.focus();
  });
})();
