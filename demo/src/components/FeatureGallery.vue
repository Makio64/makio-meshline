<template>
	<aside v-if="title" class="FeatureGalleryInspector">
		<div class="FeatureGalleryInspector-header">
			<span class="FeatureGalleryInspector-title">{{ title }}</span>
			<div class="FeatureGalleryInspector-actions">
				<button type="button" class="FeatureGalleryInspector-btn" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
				<a class="FeatureGalleryInspector-btn" href="/sandbox">Sandbox</a>
				<button type="button" class="FeatureGalleryInspector-btn" aria-label="Close snippet" @click="api.select( null )">✕</button>
			</div>
		</div>
		<pre class="FeatureGalleryInspector-code">{{ snippet }}</pre>
	</aside>
</template>

<script>
import { SNIPPETS } from '@/utils/featureGallerySnippets'

export default {
	name: 'FeatureGalleryUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return { copied: false }
	},
	computed: {
		title() {
			return this.api.selected.value
		},
		snippet() {
			return SNIPPETS[this.title]
		},
	},
	methods: {
		copy() {
			navigator.clipboard?.writeText( this.snippet ).then( () => {
				this.copied = true
				setTimeout( () => { this.copied = false }, 1400 )
			} ).catch( () => {} )
		},
	},
}
</script>

<style lang="stylus" scoped>
.FeatureGalleryInspector
	position fixed
	top calc(18px + var(--sait, 0px))
	left 50%
	transform translateX(-50%)
	z-index 25
	width unquote('min(420px, calc(100vw - 36px))')
	padding 12px 14px
	border-radius 16px
	background rgba(8, 9, 12, .84)
	border 1px solid rgba(103, 232, 249, .28)
	box-shadow 0 16px 38px rgba(0, 0, 0, .45)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	color rgba(255, 255, 255, .92)
	font 500 12px/1.45 'Inter', system-ui, -apple-system, sans-serif

	&-header
		display flex
		align-items center
		justify-content space-between
		gap 8px
		margin-bottom 8px

	&-title
		font-weight 700
		font-size 13px
		color #e0f2fe

	&-actions
		display inline-flex
		align-items center
		gap 6px

	&-btn
		padding 4px 9px
		border-radius 999px
		border 1px solid rgba(255, 255, 255, .16)
		background rgba(255, 255, 255, .07)
		color rgba(255, 255, 255, .88)
		font 600 11px/1 'Inter', system-ui, sans-serif
		text-decoration none
		cursor pointer
		&:hover
			background rgba(103, 232, 249, .18)
			border-color rgba(103, 232, 249, .45)
			color #fff

	&-code
		margin 0
		padding 9px 11px
		border-radius 10px
		background rgba(2, 6, 14, .78)
		border 1px solid rgba(255, 255, 255, .08)
		color #bae6fd
		font 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
		overflow-x auto
		white-space pre
</style>

<style lang="stylus">
// Not scoped: the demo builds these labels for CSS2DRenderer, outside this template.
.line-label
	// CSS2DRenderer only sets a transform; pin the origin so `html { text-align: center }`
	// does not shift inline-block `<button>` static positions to the horizontal center.
	top 0
	left 0
	margin 0
	min-width 60px
	padding 2px 7px
	border 1px solid rgba(255, 255, 255, .14)
	border-radius 999px
	background-color rgba(0, 0, 0, .72)
	color rgba(255, 255, 255, .9)
	font-family 'Inter', system-ui, sans-serif
	font-size 12px
	font-weight 500
	text-align center
	white-space nowrap
	cursor pointer
	// Labels wait for their line: they fade in with the first reveal.
	opacity 0
	&.is-hook
		border-color rgba(103, 232, 249, .38)
		background-color rgba(8, 47, 73, .84)
		color #cffafe
	&.is-portrait
		padding 1px 5px
		font-size 10px
	&.is-active
		border-color #38bdf8
		box-shadow 0 0 0 2px #38bdf8
</style>
