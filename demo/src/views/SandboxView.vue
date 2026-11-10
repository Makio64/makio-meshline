<template>
	<div class="sandbox-view">
		<aside
			id="sandbox-code"
			class="code-output"
			:class="{
				'no-menu': api.hasNoMenu,
				'is-mobile-open': api.uiState.compact && api.uiState.activePanel === 'code',
			}"
			:aria-hidden="api.uiState.compact && api.uiState.activePanel !== 'code'"
			aria-label="Generated code"
			@pointerdown.stop
			@wheel.stop
		>
			<header class="code-header">
				<div class="SandboxControls__titleGroup">
					<span class="SandboxControls__dot SandboxControls__dot--code" aria-hidden="true" />
					<span class="SandboxControls__title">Generated Code</span>
					<span class="SandboxControls__badge">{{ activeShapeLabel }}</span>
				</div>
				<button type="button" class="copy-button" @click="api.copyCode()">{{ copyLabel }}</button>
			</header>
			<pre class="code-content">{{ config.generatedCode }}</pre>
		</aside>

		<aside
			id="sandbox-controls"
			class="SandboxControls"
			:class="{
				'no-menu': api.hasNoMenu,
				'is-mobile-open': !uiState.controlsHidden,
			}"
			:style="{ '--topo-accent': config.color }"
			:data-open="uiState.controlsOpen ? 'true' : 'false'"
			:aria-hidden="uiState.controlsHidden"
			aria-label="Line controls"
			@pointerdown.stop
			@wheel.stop
		>
			<header class="SandboxControls__header">
				<div class="SandboxControls__titleGroup">
					<span class="SandboxControls__dot" aria-hidden="true" />
					<span class="SandboxControls__title">Line Controls</span>
					<span class="SandboxControls__badge" aria-live="polite">
						{{ activeShapeLabel }} · {{ config.segments }} segs
					</span>
				</div>
				<button
					v-if="!uiState.compact"
					type="button"
					class="SandboxControls__collapse"
					:aria-expanded="String( uiState.controlsOpen )"
					:aria-label="uiState.controlsOpen ? 'Collapse line controls' : 'Expand line controls'"
					:title="uiState.controlsOpen ? 'Collapse controls' : 'Expand controls'"
					@click="uiState.controlsOpen = !uiState.controlsOpen"
				>
					<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
						<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			</header>

			<div v-show="uiState.controlsOpen || uiState.compact" class="SandboxControls__body">
				<!-- Line Shape -->
				<section class="SandboxControls__section">
					<button
						type="button"
						class="SandboxControls__sectionHeader"
						:aria-expanded="String( sections.shape )"
						@click="sections.shape = !sections.shape"
					>
						<span>Line Shape</span>
						<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
							<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					<div v-show="sections.shape" class="SandboxControls__sectionBody">
						<div class="SandboxControls__presetGrid" role="group" aria-label="Line shape preset">
							<button
								v-for="shape in shapes"
								:key="shape.id"
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.lineType === shape.id )"
								@click="api.configureLineType( shape.id )"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>{{ shape.label }}</span>
							</button>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#38bdf8', '--slider-progress': progressPercent( config.segments, 8, 256 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-segments">Segments</label>
								<strong>{{ config.segments }}</strong>
							</div>
							<input
								id="sandbox-segments"
								type="range"
								min="8"
								max="256"
								step="1"
								:value="config.segments"
								:aria-valuetext="`${config.segments} segments`"
								@input="config.segments = Number( $event.target.value )"
							>
						</div>

						<div class="SandboxControls__toggles SandboxControls__toggles--single">
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.closed )"
								@click="config.closed = !config.closed"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Closed loop</span>
							</button>
						</div>
					</div>
				</section>

				<!-- Appearance -->
				<section class="SandboxControls__section">
					<button
						type="button"
						class="SandboxControls__sectionHeader"
						:aria-expanded="String( sections.appearance )"
						@click="sections.appearance = !sections.appearance"
					>
						<span>Appearance</span>
						<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
							<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					<div v-show="sections.appearance" class="SandboxControls__sectionBody">
						<div class="SandboxControls__colors">
							<label class="SandboxControls__colorSwatch" for="sandbox-color">
								<input id="sandbox-color" v-model="config.color" type="color" aria-label="Stroke color">
								<span class="SandboxControls__colorDot" :style="{ background: config.color, boxShadow: `0 0 8px ${config.color}` }" aria-hidden="true" />
								<span class="SandboxControls__colorMeta">
									<small>Color</small>
									<strong>{{ config.color.toUpperCase() }}</strong>
								</span>
							</label>

							<label class="SandboxControls__colorSwatch" :class="{ 'is-muted': !config.useGradient }" for="sandbox-gradient-color">
								<input id="sandbox-gradient-color" v-model="config.gradientColor" type="color" aria-label="Gradient color">
								<span class="SandboxControls__colorDot" :style="{ background: config.gradientColor, boxShadow: `0 0 8px ${config.gradientColor}` }" aria-hidden="true" />
								<span class="SandboxControls__colorMeta">
									<small>Gradient</small>
									<strong>{{ config.gradientColor.toUpperCase() }}</strong>
								</span>
							</label>
						</div>

						<div class="SandboxControls__toggles" role="group" aria-label="Appearance toggles">
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.useGradient )"
								@click="config.useGradient = !config.useGradient"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Gradient</span>
							</button>
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.sizeAttenuation )"
								@click="config.sizeAttenuation = !config.sizeAttenuation"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Attenuate</span>
							</button>
							<button
								type="button"
								class="SandboxControls__toggle SandboxControls__toggle--span"
								:aria-pressed="String( config.wireframe )"
								@click="config.wireframe = !config.wireframe"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Wireframe</span>
							</button>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': config.color, '--slider-progress': progressPercent( config.lineWidth, 0.1, 25 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-line-width">Line Width</label>
								<strong>{{ config.lineWidth.toFixed( 1 ) }}</strong>
							</div>
							<input
								id="sandbox-line-width"
								type="range"
								min="0.1"
								max="25"
								step="0.1"
								:value="config.lineWidth"
								:aria-valuetext="`line width ${config.lineWidth.toFixed( 1 )}`"
								@input="config.lineWidth = Number( $event.target.value )"
							>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#38bdf8', '--slider-progress': progressPercent( config.opacity, 0, 1 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-opacity">Opacity</label>
								<strong>{{ config.opacity.toFixed( 2 ) }}</strong>
							</div>
							<input
								id="sandbox-opacity"
								type="range"
								min="0"
								max="1"
								step="0.01"
								:value="config.opacity"
								:aria-valuetext="`opacity ${Math.round( config.opacity * 100 )} percent`"
								@input="config.opacity = Number( $event.target.value )"
							>
						</div>
					</div>
				</section>

				<!-- Dashes -->
				<section class="SandboxControls__section">
					<button
						type="button"
						class="SandboxControls__sectionHeader"
						:aria-expanded="String( sections.dashes )"
						@click="sections.dashes = !sections.dashes"
					>
						<span>Dashes</span>
						<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
							<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					<div v-show="sections.dashes" class="SandboxControls__sectionBody">
						<div class="SandboxControls__toggles" role="group" aria-label="Dash toggles">
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.useDashes )"
								@click="config.useDashes = !config.useDashes"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Use Dashes</span>
							</button>
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.animateDashes )"
								@click="config.animateDashes = !config.animateDashes"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Animate</span>
							</button>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#f59e0b', '--slider-progress': progressPercent( config.dashCount, 1, 32 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-dash-count">Dash Count</label>
								<strong>{{ config.dashCount }}</strong>
							</div>
							<input
								id="sandbox-dash-count"
								type="range"
								min="1"
								max="32"
								step="1"
								:value="config.dashCount"
								:aria-valuetext="`${config.dashCount} dashes`"
								@input="config.dashCount = Number( $event.target.value )"
							>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#fb923c', '--slider-progress': progressPercent( config.dashRatio, 0.1, 0.9 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-dash-ratio">Dash Ratio</label>
								<strong>{{ config.dashRatio.toFixed( 2 ) }}</strong>
							</div>
							<input
								id="sandbox-dash-ratio"
								type="range"
								min="0.1"
								max="0.9"
								step="0.01"
								:value="config.dashRatio"
								:aria-valuetext="`dash ratio ${config.dashRatio.toFixed( 2 )}`"
								@input="config.dashRatio = Number( $event.target.value )"
							>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#f472b6', '--slider-progress': progressPercent( config.dashOffset, 0, 1 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-dash-offset">Dash Offset</label>
								<strong>{{ config.dashOffset.toFixed( 2 ) }}</strong>
							</div>
							<input
								id="sandbox-dash-offset"
								type="range"
								min="0"
								max="1"
								step="0.01"
								:value="config.dashOffset"
								:aria-valuetext="`dash offset ${config.dashOffset.toFixed( 2 )}`"
								@input="config.dashOffset = Number( $event.target.value )"
							>
						</div>
					</div>
				</section>

				<!-- Advanced -->
				<section class="SandboxControls__section">
					<button
						type="button"
						class="SandboxControls__sectionHeader"
						:aria-expanded="String( sections.advanced )"
						@click="sections.advanced = !sections.advanced"
					>
						<span>Advanced</span>
						<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
							<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					<div v-show="sections.advanced" class="SandboxControls__sectionBody">
						<div class="SandboxControls__group">
							<span class="SandboxControls__groupLabel">Join Type</span>
							<div class="SandboxControls__toggles SandboxControls__toggles--triple" role="group" aria-label="Join type">
								<button
									v-for="join in joinTypes"
									:key="join.id"
									type="button"
									class="SandboxControls__toggle"
									:aria-pressed="String( config.joinType === join.id )"
									@click="config.joinType = join.id"
								>
									<span class="SandboxControls__toggleDot" aria-hidden="true" />
									<span>{{ join.label }}</span>
								</button>
							</div>
						</div>

						<div class="SandboxControls__group">
							<span class="SandboxControls__groupLabel">3D Fold</span>
							<div class="SandboxControls__toggles SandboxControls__toggles--triple" role="group" aria-label="3D fold mode">
								<button
									v-for="fold in foldModes"
									:key="String( fold.id )"
									type="button"
									class="SandboxControls__toggle"
									:title="fold.title"
									:aria-pressed="String( config.joinFold === fold.id )"
									@click="config.joinFold = fold.id"
								>
									<span class="SandboxControls__toggleDot" aria-hidden="true" />
									<span>{{ fold.label }}</span>
								</button>
							</div>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#34d399', '--slider-progress': progressPercent( config.miterLimit, 1, 10 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-miter-limit">Miter Limit</label>
								<strong>×{{ config.miterLimit.toFixed( 1 ) }}</strong>
							</div>
							<input
								id="sandbox-miter-limit"
								type="range"
								min="1"
								max="10"
								step="0.1"
								:value="config.miterLimit"
								:aria-valuetext="`miter limit ${config.miterLimit.toFixed( 1 )}`"
								@input="config.miterLimit = Number( $event.target.value )"
							>
						</div>

						<div class="SandboxControls__toggles" role="group" aria-label="Antialiasing and sharp bend smoothing">
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.antialias )"
								@click="config.antialias = !config.antialias"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Analytic AA</span>
							</button>
							<button
								type="button"
								class="SandboxControls__toggle"
								:aria-pressed="String( config.smoothSharpBends )"
								@click="config.smoothSharpBends = !config.smoothSharpBends"
							>
								<span class="SandboxControls__toggleDot" aria-hidden="true" />
								<span>Smooth Bends</span>
							</button>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#a78bfa', '--slider-progress': progressPercent( config.smoothSharpBendsAlpha, 0.001, 0.5 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-smooth-cutoff">Smooth Cutoff</label>
								<strong>{{ config.smoothSharpBendsAlpha.toFixed( 3 ) }}</strong>
							</div>
							<input
								id="sandbox-smooth-cutoff"
								type="range"
								min="0.001"
								max="0.5"
								step="0.001"
								:value="config.smoothSharpBendsAlpha"
								:aria-valuetext="`smooth cutoff ${config.smoothSharpBendsAlpha.toFixed( 3 )}`"
								@input="config.smoothSharpBendsAlpha = Number( $event.target.value )"
							>
						</div>

						<div
							class="SandboxControls__control"
							:style="{ '--slider-fill-color': '#fb7185', '--slider-progress': progressPercent( config.smoothSharpBendsThreshold, -1, 1 ) }"
						>
							<div class="SandboxControls__controlHeader">
								<label for="sandbox-sharp-threshold">Sharp Threshold</label>
								<strong>{{ config.smoothSharpBendsThreshold.toFixed( 2 ) }}</strong>
							</div>
							<input
								id="sandbox-sharp-threshold"
								type="range"
								min="-1"
								max="1"
								step="0.05"
								:value="config.smoothSharpBendsThreshold"
								:aria-valuetext="`sharp threshold ${config.smoothSharpBendsThreshold.toFixed( 2 )}`"
								@input="config.smoothSharpBendsThreshold = Number( $event.target.value )"
							>
						</div>
					</div>
				</section>
			</div>
		</aside>

		<nav v-if="api.uiState.compact" class="mobile-dock" aria-label="Sandbox panels">
			<button
				v-for="panel in panels"
				:key="panel.id"
				type="button"
				:class="{ active: api.uiState.activePanel === panel.id }"
				:aria-pressed="api.uiState.activePanel === panel.id"
				:aria-controls="panel.controls"
				@click="api.setMobilePanel( panel.id )"
			>
				{{ panel.label }}
			</button>
		</nav>
	</div>
</template>

<script>
const SHAPES = [
	{ id: 'snake', label: 'Snake' },
	{ id: 'helix', label: 'Helix (3D)' },
	{ id: 'circle', label: 'Circle' },
	{ id: 'sine', label: 'Sine' },
	{ id: 'square', label: 'Square' },
	{ id: 'straight', label: 'Straight' },
	{ id: 'strongAngle', label: 'Strong Angle' },
	{ id: 'zigzag', label: 'Zigzag' },
]

const JOIN_TYPES = [
	{ id: 'miter', label: 'Miter' },
	{ id: 'bevel', label: 'Bevel' },
	{ id: 'round', label: 'Round' },
]

const FOLD_MODES = [
	{ id: 'geometry', label: 'Geometry', title: 'Geometry (Fast)' },
	{ id: 'exact', label: 'Exact', title: 'Exact (2-Pass)' },
	{ id: false, label: 'Off', title: 'Off' },
]

export default {
	name: 'SandboxView',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			shapes: SHAPES,
			joinTypes: JOIN_TYPES,
			foldModes: FOLD_MODES,
			sections: {
				shape: true,
				appearance: true,
				dashes: true,
				advanced: true,
			},
			panels: [
				{ id: 'preview', label: 'Preview' },
				{ id: 'controls', label: 'Controls', controls: 'sandbox-controls' },
				{ id: 'code', label: 'Code', controls: 'sandbox-code' },
			],
		}
	},
	computed: {
		config() {
			return this.api.config
		},
		uiState() {
			return this.api.uiState
		},
		activeShapeLabel() {
			const match = this.shapes.find( shape => shape.id === this.config.lineType )
			return match ? match.label : this.config.lineType
		},
		copyLabel() {
			if ( this.api.uiState.copyState === 'copied' ) return 'Copied'
			if ( this.api.uiState.copyState === 'failed' ) return 'Copy failed'
			return 'Copy'
		},
	},
	methods: {
		progressPercent( value, min, max ) {
			return `${Math.max( 0, Math.min( 100, ( ( value - min ) / ( max - min ) ) * 100 ) ).toFixed( 1 )}%`
		},
	},
}
</script>

<style lang="stylus" scoped>
.sandbox-view
	pointer-events none

.code-output,
.SandboxControls
	--topo-accent #38bdf8
	position fixed
	z-index 25
	box-sizing border-box
	display flex
	flex-direction column
	padding 12px 14px
	border 1px solid rgba(255, 255, 255, .11)
	border-radius 18px
	background rgba(7, 11, 20, .78)
	box-shadow 0 18px 42px rgba(0, 0, 0, .42), inset 0 1px 0 rgba(255, 255, 255, .06)
	backdrop-filter blur(16px)
	-webkit-backdrop-filter blur(16px)
	color rgba(241, 245, 249, .9)
	font 500 11px/1.25 'Inter', system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	text-align left
	user-select none
	pointer-events auto

.code-output
	top calc(18px + var(--sait, 0px))
	left calc(18px + var(--sail, 0px))
	gap 10px
	width unquote('min(400px, calc(100vw - 368px))')
	max-height calc(100vh - 36px - var(--sait, 0px) - var(--saib, 0px))

	&.no-menu
		width unquote('min(320px, calc(100vw - 324px))')

.code-header
	display flex
	align-items center
	justify-content space-between
	gap 8px

.copy-button
	appearance none
	display inline-flex
	align-items center
	justify-content center
	min-height 26px
	padding 0 10px
	border 1px solid rgba(56, 189, 248, .32)
	border-radius 999px
	background rgba(56, 189, 248, .12)
	color #e0f2fe
	font 650 10px/1 'Inter', system-ui, sans-serif
	letter-spacing .04em
	text-transform uppercase
	cursor pointer
	transition background .16s ease, border-color .16s ease, color .16s ease

	&:hover
		background rgba(56, 189, 248, .22)
		border-color rgba(56, 189, 248, .52)
		color #fff

	&:focus-visible
		outline 2px solid #38bdf8
		outline-offset 2px

.code-content
	margin 0
	padding 9px 11px
	border-radius 12px
	background rgba(2, 6, 14, .78)
	border 1px solid rgba(255, 255, 255, .08)
	color #bae6fd
	font 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
	overflow auto
	scrollbar-width thin
	scrollbar-color rgba(148, 163, 184, .45) rgba(15, 23, 42, .4)
	white-space pre
	flex 1
	text-align left
	user-select text

.SandboxControls
	top calc(68px + var(--sait, 0px))
	right calc(18px + var(--sair, 0px))
	gap 10px
	width unquote('min(312px, calc(100vw - 36px))')
	max-height calc(100vh - 136px - var(--sait, 0px) - var(--saib, 0px))

	&.no-menu
		top calc(18px + var(--sait, 0px))
		width unquote('min(276px, calc(100vw - 36px))')
		max-height calc(100vh - 36px - var(--sait, 0px) - var(--saib, 0px))

	&__header
		display flex
		align-items center
		justify-content space-between
		gap 8px
		flex none

	&__titleGroup
		display flex
		align-items center
		gap 7px
		min-width 0

	&__dot
		flex none
		width 7px
		height 7px
		border-radius 50%
		background var(--topo-accent)
		box-shadow 0 0 10px var(--topo-accent)
		transition background .2s ease, box-shadow .2s ease

		&--code
			background #38bdf8
			box-shadow 0 0 10px #38bdf8

	&__title
		color #fff
		font-size 10.5px
		font-weight 750
		letter-spacing .1em
		text-transform uppercase
		white-space nowrap

	&__badge
		padding 3px 8px
		border 1px solid rgba(56, 189, 248, .28)
		border-radius 999px
		background rgba(56, 189, 248, .12)
		color #7dd3fc
		font-size 9.5px
		font-weight 700
		letter-spacing .04em
		white-space nowrap
		overflow hidden
		text-overflow ellipsis

	&__collapse
		appearance none
		display inline-flex
		align-items center
		justify-content center
		width 26px
		height 26px
		padding 0
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 8px
		background rgba(255, 255, 255, .05)
		color rgba(226, 232, 240, .78)
		cursor pointer
		transition background .16s ease, border-color .16s ease, color .16s ease

		svg
			transition transform .2s ease

		&[aria-expanded='false'] svg
			transform rotate(-90deg)

		&:hover
			border-color rgba(255, 255, 255, .22)
			background rgba(255, 255, 255, .11)
			color #fff

		&:focus-visible
			outline 2px solid var(--topo-accent)
			outline-offset 2px

	&__body
		display grid
		gap 8px
		overflow-y auto
		padding-right 2px
		scrollbar-width thin
		scrollbar-color rgba(148, 163, 184, .45) rgba(15, 23, 42, .4)

	&__section
		display grid
		gap 8px
		padding 8px 10px
		border 1px solid rgba(255, 255, 255, .07)
		border-radius 12px
		background rgba(15, 23, 42, .46)

	&__sectionHeader
		appearance none
		display flex
		align-items center
		justify-content space-between
		gap 6px
		width 100%
		margin 0
		padding 0
		border 0
		background transparent
		color rgba(226, 232, 240, .88)
		font 750 9.5px/1 'Inter', system-ui, -apple-system, sans-serif
		letter-spacing .09em
		text-transform uppercase
		cursor pointer

		svg
			color rgba(148, 163, 184, .75)
			transition transform .2s ease

		&[aria-expanded='false'] svg
			transform rotate(-90deg)

		&:hover
			color #fff

		&:focus-visible
			outline 2px solid #38bdf8
			outline-offset 2px

	&__sectionBody
		display grid
		gap 8px

	&__group
		display grid
		gap 4px

	&__groupLabel
		color rgba(203, 213, 225, .72)
		font-size 9.5px
		font-weight 600
		letter-spacing .02em

	&__presetGrid
		display grid
		grid-template-columns 1fr 1fr
		gap 5px

	&__toggles
		display grid
		grid-template-columns 1fr 1fr
		gap 5px

		&--single
			grid-template-columns 1fr

		&--triple
			grid-template-columns repeat(3, minmax(0, 1fr))

	&__toggle
		appearance none
		display inline-flex
		align-items center
		justify-content center
		gap 5px
		min-height 28px
		padding 0 8px
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 9px
		background rgba(255, 255, 255, .04)
		color rgba(226, 232, 240, .72)
		font 650 9.5px/1 'Inter', system-ui, -apple-system, sans-serif
		letter-spacing .04em
		text-transform uppercase
		white-space nowrap
		cursor pointer
		transition border-color .16s ease, background .16s ease, color .16s ease

		&--span
			grid-column 1 / -1

		&:hover
			background rgba(255, 255, 255, .09)
			color #fff

		&:focus-visible
			outline 2px solid #38bdf8
			outline-offset 2px

		&[aria-pressed='true']
			border-color rgba(56, 189, 248, .42)
			background rgba(56, 189, 248, .16)
			color #fff

			.SandboxControls__toggleDot
				background #38bdf8
				box-shadow 0 0 8px #38bdf8
				opacity 1

	&__toggleDot
		flex none
		width 5.5px
		height 5.5px
		border-radius 50%
		background currentColor
		opacity .45
		transition background .16s ease, box-shadow .16s ease, opacity .16s ease

	&__colors
		display grid
		grid-template-columns 1fr 1fr
		gap 6px

	&__colorSwatch
		position relative
		display flex
		align-items center
		gap 7px
		min-height 32px
		padding 4px 8px
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 10px
		background rgba(255, 255, 255, .04)
		cursor pointer
		transition border-color .16s ease, background .16s ease, opacity .16s ease

		&.is-muted
			opacity .5

		&:hover
			border-color rgba(255, 255, 255, .22)
			background rgba(255, 255, 255, .08)

		&:focus-within
			outline 2px solid #38bdf8
			outline-offset 2px

		input[type='color']
			position absolute
			inset 0
			width 100%
			height 100%
			margin 0
			padding 0
			border 0
			opacity 0
			cursor pointer

	&__colorDot
		flex none
		width 14px
		height 14px
		border 1.5px solid rgba(255, 255, 255, .75)
		border-radius 50%

	&__colorMeta
		display grid
		gap 1px
		min-width 0

		small
			color rgba(186, 206, 228, .62)
			font-size 8.5px
			font-weight 650
			letter-spacing .05em
			text-transform uppercase

		strong
			color #f8fafc
			font-size 10px
			font-weight 700

	&__control
		display grid
		gap 3px

	&__controlHeader
		display flex
		align-items baseline
		justify-content space-between
		gap 8px

		label
			color rgba(203, 213, 225, .78)
			font-size 10px
			font-weight 600
			letter-spacing .02em
			cursor pointer

		strong
			color #f8fafc
			font-size 10.5px
			font-weight 700

	input[type='range']
		--slider-track-size 4px
		--slider-thumb-size 13px
		--slider-track-radius 999px
		--slider-thumb-radius 50%
		--slider-track-color rgba(255, 255, 255, .14)
		--slider-thumb-color #f8fafc
		appearance none
		inline-size 100%
		block-size 18px
		margin 0
		padding 0
		border 0
		border-radius 0
		background transparent
		cursor pointer

	input[type='range']::-webkit-slider-runnable-track
		block-size var(--slider-track-size)
		border 0
		border-radius var(--slider-track-radius)
		background linear-gradient(to right, var(--slider-fill-color) 0 var(--slider-progress), var(--slider-track-color) var(--slider-progress) 100%)

	input[type='range']::-webkit-slider-thumb
		-webkit-appearance none
		appearance none
		inline-size var(--slider-thumb-size)
		block-size var(--slider-thumb-size)
		margin-block-start calc((var(--slider-track-size) - var(--slider-thumb-size)) / 2)
		border 2px solid var(--slider-fill-color)
		border-radius var(--slider-thumb-radius)
		background var(--slider-thumb-color)
		box-shadow 0 2px 6px rgba(0, 0, 0, .4)
		transition transform .12s ease

	input[type='range']:hover::-webkit-slider-thumb
		transform scale(1.12)

	input[type='range']::-moz-range-track
		block-size var(--slider-track-size)
		border 0
		border-radius var(--slider-track-radius)
		background var(--slider-track-color)

	input[type='range']::-moz-range-progress
		block-size var(--slider-track-size)
		border-radius var(--slider-track-radius)
		background var(--slider-fill-color)

	input[type='range']::-moz-range-thumb
		inline-size var(--slider-thumb-size)
		block-size var(--slider-thumb-size)
		border 2px solid var(--slider-fill-color)
		border-radius var(--slider-thumb-radius)
		background var(--slider-thumb-color)
		box-shadow 0 2px 6px rgba(0, 0, 0, .4)

	input[type='range']:focus-visible
		outline 2px solid var(--slider-fill-color)
		outline-offset 3px

.mobile-dock
	display none

@media (max-width: 768px)
	.code-output,
	.SandboxControls
		display none
		top auto
		right calc(8px + var(--sair, 0px))
		bottom calc(114px + var(--saib, 0px))
		left calc(8px + var(--sail, 0px))
		width auto
		max-height min(52vh, 440px)

		&.no-menu
			top auto
			width auto
			max-height min(52vh, 440px)

		&.is-mobile-open
			display flex

	.mobile-dock
		position fixed
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 4px
		left calc(8px + var(--sail, 0px))
		right calc(8px + var(--sair, 0px))
		bottom calc(58px + var(--saib, 0px))
		z-index 1200
		box-sizing border-box
		height 48px
		padding 4px
		border 1px solid rgba(255, 255, 255, .15)
		border-radius 14px
		background rgba(5, 8, 16, .84)
		box-shadow 0 16px 40px rgba(0, 0, 0, .45)
		backdrop-filter blur(14px)
		pointer-events auto

		button
			appearance none
			border 0
			border-radius 10px
			background transparent
			color rgba(255, 255, 255, .62)
			font 650 11px/1 system-ui, sans-serif
			letter-spacing .03em
			cursor pointer

			&.active
				background rgba(56, 189, 248, .18)
				color #e0f2fe
				box-shadow inset 0 0 0 1px rgba(56, 189, 248, .28)

			&:focus-visible
				outline 2px solid #38bdf8
				outline-offset -2px

@media (prefers-reduced-motion: reduce)
	.copy-button,
	.SandboxControls__dot,
	.SandboxControls__collapse,
	.SandboxControls__collapse svg,
	.SandboxControls__sectionHeader svg,
	.SandboxControls__toggle,
	.SandboxControls__toggleDot,
	.SandboxControls__colorSwatch,
	.SandboxControls input[type='range']::-webkit-slider-thumb
		transition none
</style>
