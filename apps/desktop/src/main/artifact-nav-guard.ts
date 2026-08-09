/** postMessage type from injected preview guard → renderer. */
export const ARTIFACT_OPEN_EXTERNAL_MSG = 'sideboard-artifact-open-external';

/**
 * Keep iframe from navigating away on link clicks (relative → 404 white page;
 * http(s) would replace the artifact). Hash / same-document links still work;
 * http(s)/mailto open via parent postMessage.
 */
export function injectArtifactNavigationGuard(html: string): string {
  if (html.includes('data-sideboard-artifact-nav')) return html;
  const script = `<script data-sideboard-artifact-nav>
(function () {
  var MSG = ${JSON.stringify(ARTIFACT_OPEN_EXTERNAL_MSG)};
  function abs(href) {
    try { return new URL(href, location.href); } catch (e) { return null; }
  }
  function externalHref(href) {
    var u = abs(href);
    if (!u) return null;
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
      return u.href;
    }
    return null;
  }
  function sameDocument(href) {
    if (!href || href === '#') return true;
    if (href.charAt(0) === '#') return true;
    var u = abs(href);
    if (!u) return false;
    return (
      u.origin === location.origin &&
      u.pathname === location.pathname &&
      u.search === location.search
    );
  }
  function handleUrl(href, event) {
    if (!href || href.indexOf('javascript:') === 0) return;
    if (sameDocument(href)) return;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    var ext = externalHref(href);
    if (ext) {
      try { parent.postMessage({ type: MSG, url: ext }, '*'); } catch (e) {}
    }
  }
  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (!a) return;
      handleUrl(a.getAttribute('href'), e);
    },
    true,
  );
  var nativeOpen = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && url) {
      handleUrl(url, null);
      return null;
    }
    if (typeof nativeOpen === 'function') {
      return nativeOpen.apply(window, arguments);
    }
    return null;
  };
})();
</script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${script}</body>`);
  }
  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${script}</html>`);
  }
  return `${html}${script}`;
}
