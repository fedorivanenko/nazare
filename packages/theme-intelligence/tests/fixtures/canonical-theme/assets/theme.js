class ProductCard extends HTMLElement {}

customElements.define("product-card", ProductCard);

const productCard = document.querySelector("[data-product-card]");
if (productCard) {
	const target = productCard.dataset.product;
	document.querySelector(`[data-product-panel="${target}"]`);
	productCard.classList.toggle("is-active");
}

const cartDrawer = document.querySelector("[data-cart-drawer]");
cartDrawer?.classList.toggle("is-active");

window.addEventListener("cart:update", () => {});
window.dispatchEvent(new CustomEvent("cart:update"));
