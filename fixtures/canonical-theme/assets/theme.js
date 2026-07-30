class ProductCard extends HTMLElement {}

customElements.define("product-card", ProductCard);
document.querySelector("[data-product-card]");
window.addEventListener("cart:update", () => {});
window.dispatchEvent(new CustomEvent("cart:update"));
