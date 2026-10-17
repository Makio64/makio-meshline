<template>
	<div class="sandbox-view">
		<div
			id="sandbox-code"
			ref="codeOutput"
			class="code-output"
			:class="{
				'no-menu': api.hasNoMenu,
				'is-mobile-open': api.uiState.compact && api.uiState.activePanel === 'code',
			}"
			:aria-hidden="api.uiState.compact && api.uiState.activePanel !== 'code'"
		>
			<div class="code-header">
				<span class="code-title">Generated Code</span>
				<button class="copy-button" @click="api.copyCode()">{{ copyLabel }}</button>
			</div>
			<div v-if="api.config.highlightedCode && api.config.highlightedCode !== api.config.generatedCode" class="code-content" v-html="api.config.highlightedCode" />
			<pre v-else class="code-content">{{ api.config.generatedCode }}</pre>
		</div>
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
export default {
	name: 'SandboxView',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			panels: [
				{ id: 'preview', label: 'Preview', controls: null },
				{ id: 'controls', label: 'Controls', controls: 'sandbox-controls' },
				{ id: 'code', label: 'Code', controls: 'sandbox-code' },
			],
		}
	},
	computed: {
		copyLabel() {
			if ( this.api.uiState.copyState === 'copied' ) return 'Copied'
			if ( this.api.uiState.copyState === 'failed' ) return 'Copy failed'
			return 'Copy'
		},
	},
}
</script>

<style lang="stylus" scoped>
.sandbox-view
	bottom auto
	font-family 'Roboto Mono', monospace
	pointer-events none

.code-output
	position fixed
	top 10px
	left 10px
	right 370px
	background rgba(0, 0, 0, 0.9)
	border 1px solid rgba(255, 255, 255, 0.1)
	border-radius 8px
	overflow hidden
	display flex
	flex-direction column
	max-width 400px
	pointer-events auto
	
	&.no-menu
		right 240px
		max-width 320px

.code-header
	background rgba(255, 255, 255, 0.05)
	padding 10px 15px
	display flex
	justify-content space-between
	align-items center
	border-bottom 1px solid rgba(255, 255, 255, 0.1)

.code-title
	color white
	font-size 12px
	font-weight 600
	text-transform uppercase
	letter-spacing 0.5px

.copy-button
	background rgba(255, 255, 255, 0.1)
	border 1px solid rgba(255, 255, 255, 0.2)
	color white
	padding 4px 12px
	border-radius 4px
	cursor pointer
	font-size 12px
	transition all 0.2s ease
	&:hover
		background rgba(255, 255, 255, 0.2)
		border-color rgba(255, 255, 255, 0.3)
	&:focus-visible
		outline 2px solid #38bdf8
		outline-offset 2px

.code-content
	color white
	padding 15px
	font-family 'Roboto Mono', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace
	font-size 13px
	line-height 1.6
	margin 0
	overflow-x auto
	overflow-y auto
	flex 1
	text-align left
	
	.no-menu &
		font-size 11px
		line-height 1.5
		padding 12px
	
	// Shiki styles
	:deep(pre)
		margin 0
		padding 0
		background transparent !important
	
	:deep(code)
		font-family inherit
		font-size inherit
		line-height inherit

.mobile-dock
	display none

@media (max-width: 768px)
	.code-output
		display none
		top auto
		right calc(8px + var(--sair, 0px))
		bottom calc(114px + var(--saib, 0px))
		left calc(8px + var(--sail, 0px))
		height min(52vh, 440px)
		max-width none
		max-height none
		border-radius 13px
		box-shadow 0 20px 50px rgba(0, 0, 0, 0.55)
		&.no-menu
			right calc(8px + var(--sair, 0px))
			max-width none
		&.is-mobile-open
			display flex

	.code-content
		font-size 11px
		line-height 1.5
		padding 12px

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
		border 1px solid rgba(255, 255, 255, 0.15)
		border-radius 14px
		background rgba(5, 8, 16, 0.84)
		box-shadow 0 16px 40px rgba(0, 0, 0, 0.45)
		backdrop-filter blur(14px)
		pointer-events auto

		button
			appearance none
			border 0
			border-radius 10px
			background transparent
			color rgba(255, 255, 255, 0.62)
			font 650 11px/1 system-ui, sans-serif
			letter-spacing 0.03em
			cursor pointer

			&.active
				background rgba(56, 189, 248, 0.18)
				color #e0f2fe
				box-shadow inset 0 0 0 1px rgba(56, 189, 248, 0.28)

			&:focus-visible
				outline 2px solid #38bdf8
				outline-offset -2px

	:global(.SandboxControls)
		--width calc(100vw - 16px - var(--sail, 0px) - var(--sair, 0px))
		top auto !important
		right calc(8px + var(--sair, 0px)) !important
		bottom calc(114px + var(--saib, 0px))
		left calc(8px + var(--sail, 0px))
		z-index 1100 !important
		max-height min(52vh, 440px)
		overflow-y auto
		border-radius 13px
		box-shadow 0 20px 50px rgba(0, 0, 0, 0.55)
</style>
