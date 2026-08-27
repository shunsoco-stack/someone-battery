(() => {
  try {
    const saved = localStorage.getItem("someone-battery:theme");
    const theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    // A storage-disabled browser still has a complete, dark-mode experience.
  }
})();
