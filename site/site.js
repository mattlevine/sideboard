(function () {
  var tabs = document.querySelectorAll("[data-tab]");
  if (!tabs.length) return;
  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-tab");
      tabs.forEach(function (other) {
        var on = other === btn;
        other.classList.toggle("is-on", on);
        other.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.querySelectorAll("[data-panel]").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-panel") !== id;
      });
    });
  });
})();
