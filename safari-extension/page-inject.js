// Shared page-context script injection.
// Chrome MV3: background uses chrome.scripting.executeScript (MAIN world).
// Safari: append <script src="chrome-extension://..."> (allowed there).
const DownpourInject = (function () {
  const injected = new Map();
  const useScriptingInject = (() => {
    try {
      const perms = chrome.runtime.getManifest().permissions || [];
      return perms.includes("scripting");
    } catch (e) {
      return false;
    }
  })();

  function injectViaDom(resource) {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(resource);
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => resolve();
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function injectViaScripting(resource) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "injectPageScript", file: resource }, () => {
        resolve();
      });
    });
  }

  function pageScript(resource, datasetFlag) {
    const key = datasetFlag || resource;
    if (injected.has(key)) return injected.get(key);
    if (datasetFlag) document.documentElement.dataset[datasetFlag] = "1";
    const promise = useScriptingInject
      ? injectViaScripting(resource)
      : injectViaDom(resource);
    injected.set(key, promise);
    return promise;
  }

  return { pageScript };
})();