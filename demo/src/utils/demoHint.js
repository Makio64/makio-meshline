const STYLE_ID = 'DemoHintStyle'

const ensureStyle = () => {
	if ( document.getElementById( STYLE_ID ) ) return
	const style = document.createElement( 'style' )
	style.id = STYLE_ID
	style.textContent = `
		.DemoHint {
			position: fixed;
			left: calc(16px + var(--sail, 0px));
			top: calc(16px + var(--sait, 0px));
			z-index: 20;
			display: inline-flex;
			align-items: center;
			gap: 8px;
			max-width: calc(100vw - 96px);
			padding: 8px 12px;
			border: 1px solid rgba(255, 255, 255, .14);
			border-radius: 999px;
			background: rgba(4, 7, 16, .62);
			box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
			backdrop-filter: blur(8px);
			color: rgba(236, 242, 255, .9);
			font: 650 10px/1.2 system-ui, sans-serif;
			letter-spacing: .07em;
			text-transform: uppercase;
			pointer-events: none;
			user-select: none;
			transition: opacity .3s ease, transform .3s ease;
		}
		.DemoHint::before {
			content: '';
			flex: 0 0 auto;
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--demo-hint-accent, #7dd3fc);
			box-shadow: 0 0 10px var(--demo-hint-accent, #7dd3fc);
		}
		.DemoHint.is-hidden {
			opacity: 0;
			transform: translateY(-4px);
		}
		@media (max-width: 600px) {
			.DemoHint { left: calc(10px + var(--sail, 0px)); top: calc(10px + var(--sait, 0px)); font-size: 9px; }
		}
		@media (prefers-reduced-motion: reduce) { .DemoHint { transition: none; } }
	`
	document.head.appendChild( style )
}

/**
 * Small pill in the top-left corner that tells the visitor how to interact.
 * Hidden with `?noUI` so embedded demos stay clean.
 */
export function createDemoHint( text, { accent = '#7dd3fc', hideAfter = 0 } = {} ) {
	if ( typeof document === 'undefined' || new URLSearchParams( window.location.search ).has( 'noUI' ) ) {
		return { hide() {}, remove() {} }
	}

	ensureStyle()
	const element = document.createElement( 'div' )
	element.className = 'DemoHint'
	element.textContent = text
	element.style.setProperty( '--demo-hint-accent', accent )
	document.body.appendChild( element )

	let timer = hideAfter > 0 ? window.setTimeout( () => hint.hide(), hideAfter ) : 0
	const hint = {
		hide() {
			element.classList.add( 'is-hidden' )
		},
		remove() {
			window.clearTimeout( timer )
			timer = 0
			element.remove()
		},
	}
	return hint
}
