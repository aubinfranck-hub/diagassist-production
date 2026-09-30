// Exécuté dans la page HP-Web, avec la session de l'utilisateur.
// Lecture de la page et actions limitées aux éléments numérotés : aucune URL arbitraire,
// aucun champ mot de passe (l'utilisateur se connecte lui-même).
(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const label = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 80);

  function snapshot() {
    document.querySelectorAll("[data-dx]").forEach((el) => el.removeAttribute("data-dx"));
    const els = [...document.querySelectorAll("a[href], button, [role=button], [role=tab], [role=menuitem], input:not([type=hidden]):not([type=password]), select, textarea, summary")]
      .filter(vis).slice(0, 120);
    const elements = els.map((el, i) => {
      el.setAttribute("data-dx", String(i));
      const tag = el.tagName.toLowerCase();
      const kind = tag === "select" ? "select" : (tag === "input" || tag === "textarea") ? "champ" : tag === "a" ? "lien" : "bouton";
      const out = { ref: i, kind, label: label(el) };
      if (tag === "select") out.options = [...el.options].slice(0, 40).map((o) => o.text.trim());
      return out;
    });
    const hasPassword = !!document.querySelector("input[type=password]");
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 6000),
      elements,
      loginRequired: hasPassword
    };
  }

  const byRef = (ref) => document.querySelector(`[data-dx="${Number(ref)}"]`);

  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== "hpweb-content") return;
    try {
      if (msg.action === "snapshot") return sendResponse({ ok: true, page: snapshot() });
      const el = byRef(msg.args?.ref);
      if (msg.action !== "back" && !el) return sendResponse({ ok: false, error: "Élément introuvable : relire la page" });

      if (msg.action === "click") { sendResponse({ ok: true }); el.click(); return; }
      if (msg.action === "type") {
        el.focus();
        setValue(el, String(msg.args?.text || "").slice(0, 200));
        if (msg.args?.submit) {
          for (const t of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          if (el.form) { sendResponse({ ok: true }); el.form.requestSubmit?.(); return; }
        }
        return sendResponse({ ok: true });
      }
      if (msg.action === "select") {
        const wanted = String(msg.args?.label || "").trim().toLowerCase();
        const opts = [...el.options];
        const hit = opts.find((o) => o.text.trim().toLowerCase() === wanted) || opts.find((o) => o.text.toLowerCase().includes(wanted));
        if (!hit) return sendResponse({ ok: false, error: "Option introuvable : " + wanted });
        el.value = hit.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return sendResponse({ ok: true });
      }
      if (msg.action === "back") { sendResponse({ ok: true }); history.back(); return; }
      sendResponse({ ok: false, error: "Action inconnue" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  });
})();
