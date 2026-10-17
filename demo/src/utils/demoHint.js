const STYLE_ID = 'DemoHintStyle'

const ensureStyle = () => {
	if ( document.getElementById( STYLE_ID ) ) return
	const style = document.createElement( 'style' )
	style.id = STYLE_ID
	style.textContent = `
		.DemoHint {
			position: fixed;
			left: calc(18px + var(--sail, 0px));
			top: calc(18px + var(--sait, 0px));
			z-index: 20;
			display: inline-flex;
			align-items: center;
			gap: 8px;
			min-height: 36px;
			max-width: min(420px, calc(100vw - 96px));
			padding: 6px 14px;
			border: 1px solid rgba(255, 255, 255, .1);
			border-radius: 999px;
			background: rgba(8, 9, 12, .7);
			box-shadow: 0 12px 30px rgba(0, 0, 0, .28);
			backdrop-filter: blur(14px);
			-webkit-backdrop-filter: blur(14px);
			color: rgba(244, 245, 247, .88);
			font: 600 10px/1.25 'Inter', system-ui, -apple-system, sans-serif;
			letter-spacing: .06em;
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
		@media (max-width: 720px) {
			.DemoHint {
				left: calc(12px + var(--sail, 0px));
				top: calc(58px + var(--sait, 0px));
				min-height: 30px;
				padding: 4px 11px;
				font-size: 9px;
			}
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
