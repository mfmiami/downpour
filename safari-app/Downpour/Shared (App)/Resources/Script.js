function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) {
        document.querySelector(".state-on").innerText =
            "Downpour is currently on. You can turn it off in the Extensions section of Safari Settings.";
        document.querySelector(".state-off").innerText =
            "Downpour is currently off. You can turn it on in the Extensions section of Safari Settings.";
        document.querySelector(".state-unknown").innerText =
            "You can turn on Downpour in the Extensions section of Safari Settings.";
        document.querySelector(".open-preferences").innerText =
            "Quit and Open Safari Settings…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);