document.addEventListener("DOMContentLoaded", () => {
  for (const element of document.querySelectorAll("[data-price]")) {
    element.dataset.priceReady = "true";
  }
});
