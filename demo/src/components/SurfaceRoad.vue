<template>
	<div class="SurfaceRoadHud">
		<p class="SurfaceRoadHud__hint">
			<strong>Drag</strong> a point · <strong>↕ arrows</strong> or Shift-drag for height · <strong>Alt-drag</strong> to bank ·
			<strong>Double-click</strong> to add or remove · <strong>⌫</strong> delete selected
		</p>

		<div class="SurfaceRoadHud__status" :class="`SurfaceRoadHud__status--${ui.status}`" aria-live="polite">
			<span>{{ ui.controls }} points → {{ ui.samples }} samples</span>
			<span>point {{ ui.selected }}: {{ ui.clearance }}m · {{ ui.bank }}°</span>
			<span v-if="ui.terrainLift > 0">terrain fit +{{ ui.terrainLift }}m</span>
			<span v-if="ui.fallback" class="SurfaceRoadHud__warn">last safe road kept</span>
			<span v-if="ui.tight" class="SurfaceRoadHud__warn">{{ ui.tight }} tighter than the road is wide</span>
		</div>

		<div class="SurfaceRoadHud__bar" @pointerdown.stop>
			<button
				class="SurfaceRoadHud__chip"
				type="button"
				title="Previous point ([)"
				aria-label="Select previous point"
				@click="selectRelative( -1 )"
			>‹</button>
			<button
				class="SurfaceRoadHud__chip"
				type="button"
				title="Next point (])"
				aria-label="Select next point"
				@click="selectRelative( 1 )"
			>›</button>
			<button
				v-if="ui.controls > 2"
				class="SurfaceRoadHud__chip SurfaceRoadHud__chip--danger"
				type="button"
				title="Delete selected point (Delete / Backspace)"
				@click="removeSelected"
			>Delete pt</button>
			<button
				class="SurfaceRoadHud__chip"
				type="button"
				@click="resetRoad"
			>Valley</button>
			<button
				class="SurfaceRoadHud__chip"
				type="button"
				@click="elevatedPreset"
			>3D Overpass</button>
			<button
				class="SurfaceRoadHud__chip"
				type="button"
				title="Generate random road (R)"
				@click="randomRoad"
			>Random</button>
			<button
				class="SurfaceRoadHud__toggle"
				type="button"
				:aria-pressed="ui.debug"
				@pointerdown.stop
				@click="toggleDebug"
			>
				<span class="SurfaceRoadHud__dot" :class="{ 'is-on': ui.debug }" aria-hidden="true" />
				<span>Construction: {{ ui.debug ? 'on' : 'off' }}</span>
				<span class="SurfaceRoadHud__key">D</span>
			</button>
		</div>

		<div v-if="ui.debug" class="SurfaceRoadHud__legend">
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--control" />Authored control points</span>
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--polygon" />Straight route between them</span>
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--path" />Planned centreline</span>
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--arc" />Turn too hard for the curve</span>
			<span>{{ ui.bends }} widened bends</span>
			<span>{{ ui.arcs }} fixed-radius turns</span>
		</div>
	</div>

	<aside
		v-if="!hideSaves"
		class="SurfaceRoadSaves"
		:class="{ 'is-collapsed': !savesOpen }"
		aria-label="Saved roads"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<header class="SurfaceRoadSaves__header">
			<div>
				<p class="SurfaceRoadSaves__eyebrow">Saves</p>
				<span class="SurfaceRoadSaves__status" aria-live="polite">{{ ui.saveMessage || (ui.storageAvailable ? 'Autosaves this route' : 'Storage blocked · export still works') }}</span>
			</div>
			<button
				class="SurfaceRoadSaves__collapse"
				type="button"
				:aria-expanded="savesOpen"
				:aria-label="savesOpen ? 'Collapse saved roads' : 'Expand saved roads'"
				@click="savesOpen = !savesOpen"
			>{{ savesOpen ? 'Hide' : 'Show' }}</button>
		</header>

		<template v-if="savesOpen">
			<form class="SurfaceRoadSaves__form" @submit.prevent="saveNamed">
				<label class="SurfaceRoadSaves__field">
					<span class="SurfaceRoadSaves__sr">Save name</span>
					<input
						v-model="ui.saveName"
						type="text"
						maxlength="40"
						placeholder="Name this road"
						autocomplete="off"
						spellcheck="false"
					>
				</label>
				<button type="submit">Save</button>
			</form>

			<ul v-if="ui.saves.length" class="SurfaceRoadSaves__list">
				<li v-for="save in ui.saves" :key="save.id">
					<button
						class="SurfaceRoadSaves__slot"
						type="button"
						:class="{ 'is-active': save.id === ui.activeSaveId }"
						@click="loadSave( save.id )"
					>
						<strong>{{ save.name }}</strong>
						<span>{{ save.points }} pts · {{ formatSavedAt( save.savedAt ) }}</span>
					</button>
					<button
						v-if="!save.autosave"
						class="SurfaceRoadSaves__delete"
						type="button"
						:aria-label="`Delete ${save.name}`"
						@click.stop="deleteSave( save.id )"
					>×</button>
				</li>
			</ul>
			<p v-else class="SurfaceRoadSaves__empty">Edit the road to autosave, or save a named copy.</p>

			<div class="SurfaceRoadSaves__actions">
				<button type="button" @click="exportRoad">Export</button>
				<button type="button" @click="importRoad">Import</button>
				<button type="button" @click="copyLink">Copy link</button>
			</div>
			<p class="SurfaceRoadSaves__hint"><span class="SurfaceRoadSaves__key">⌘S</span> save · JSON files and share links restore the same controls</p>
		</template>
	</aside>
</template>

<script>
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

export default {
	name: 'SurfaceRoadUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			savesOpen: false,
		}
	},
	computed: {
		ui() {
			return this.api.ui
		},
		hideSaves() {
			return new URLSearchParams( window.location.search ).has( 'noUI' )
		},
	},
	mounted() {
		keyboard.onDown.add( this.onKey )
	},
	unmounted() {
		keyboard.onDown.remove( this.onKey )
	},
	methods: {
		onKey( key, event ) {
			const target = event?.target
			const isEditable = target?.matches?.( 'input, textarea, select, [contenteditable="true"]' )
			if ( event?.repeat || event?.defaultPrevented || menuOpen.value ) return
			if ( ( event?.ctrlKey || event?.metaKey ) && ( key === 's' || key === 'S' ) ) {
				event.preventDefault()
				this.saveNamed()
				return
			}
			if ( event?.altKey || event?.ctrlKey || event?.metaKey || isEditable ) return
			if ( key === 'd' || key === 'D' ) this.toggleDebug()
			else if ( key === 'r' || key === 'R' ) this.randomRoad()
			else if ( key === '[' ) this.selectRelative( -1 )
			else if ( key === ']' ) this.selectRelative( 1 )
			else if ( key === 'Backspace' || key === 'Delete' ) {
				event?.preventDefault?.()
				this.removeSelected()
			}
		},
		toggleDebug() {
			this.api.toggleDebug()
		},
		selectRelative( delta ) {
			this.api.selectRelativeControl( delta )
		},
		removeSelected() {
			this.api.removeSelectedControl()
		},
		resetRoad() {
			this.api.resetRoad()
		},
		elevatedPreset() {
			this.api.setElevatedPreset()
		},
		randomRoad() {
			this.api.setRandomControls()
		},
		saveNamed() {
			this.api.saveNamedRoad( this.ui.saveName )
		},
		loadSave( id ) {
			this.api.loadSavedRoad( id )
		},
		deleteSave( id ) {
			this.api.deleteSavedRoad( id )
		},
		exportRoad() {
			this.api.exportRoadFile()
		},
		importRoad() {
			this.api.importRoadFile()
		},
		copyLink() {
			this.api.copyShareLink()
		},
		formatSavedAt( value ) {
			const time = Date.parse( value )
			if ( !Number.isFinite( time ) ) return 'just now'
			const elapsed = Date.now() - time
			if ( elapsed < 15000 ) return 'just now'
			if ( elapsed < 60000 ) return `${Math.max( 1, Math.round( elapsed / 1000 ) )}s ago`
			if ( elapsed < 3600000 ) return `${Math.max( 1, Math.round( elapsed / 60000 ) )}m ago`
			if ( elapsed < 86400000 ) return `${Math.max( 1, Math.round( elapsed / 3600000 ) )}h ago`
			return `${Math.max( 1, Math.round( elapsed / 86400000 ) )}d ago`
		},
	},
}
</script>

<style lang="stylus" scoped>
.SurfaceRoadHud
	position fixed
	left 50%
	top 22px
	transform translateX(-50%)
	z-index 20
	display flex
	flex-direction column
	align-items center
	gap 7px
	width max-content
	max-width calc(100vw - 32px)
	font 500 12px/1.3 system-ui, -apple-system, sans-serif
	color #f8fbff
	user-select none

	&__hint
		margin 0
		padding 6px 12px
		border-radius 999px
		background rgba(5, 13, 18, .72)
		box-shadow 0 2px 10px rgba(0, 0, 0, .25)
		backdrop-filter blur(6px)
		-webkit-backdrop-filter blur(6px)
		font-size 11px
		text-align center
		color rgba(255, 255, 255, .92)

		strong
			font-weight 700
			color #7fe6ff

	&__status
		display flex
		flex-wrap wrap
		justify-content center
		gap 6px 12px
		padding 5px 12px
		border 1px solid rgba(255, 255, 255, .16)
		border-radius 999px
		background rgba(5, 13, 18, .72)
		font-size 11px
		letter-spacing .02em
		transition border-color .2s ease

		&--arc
			border-color rgba(83, 198, 255, .6)

		&--tight
			border-color rgba(255, 93, 108, .7)

	&__warn
		color #ff9aa4

	&__bar
		display flex
		flex-wrap wrap
		align-items center
		justify-content center
		gap 5px

	&__chip
		appearance none
		margin 0
		padding 6px 10px
		border 1px solid rgba(255, 255, 255, .2)
		border-radius 999px
		background rgba(5, 13, 18, .8)
		font inherit
		font-weight 600
		font-size 11px
		color inherit
		cursor pointer
		transition border-color .2s ease, background .2s ease

		&:hover
			border-color #8cecff
			background rgba(83, 198, 255, .16)

		&:focus-visible
			outline 2px solid #fff
			outline-offset 2px

		&--danger
			border-color rgba(255, 93, 108, .55)
			color #ffb0b8

			&:hover
				border-color #ff7a88
				background rgba(255, 93, 108, .18)

	&__toggle
		appearance none
		display flex
		align-items center
		gap 8px
		margin 0
		padding 6px 12px
		border 1px solid rgba(104, 225, 255, .5)
		border-radius 999px
		background rgba(5, 13, 18, .86)
		font inherit
		font-weight 700
		font-size 11px
		letter-spacing .06em
		text-transform uppercase
		color inherit
		cursor pointer
		transition border-color .2s ease

		&:hover
			border-color #8cecff

		&:focus-visible
			outline 2px solid #fff
			outline-offset 3px

	&__dot
		width 8px
		height 8px
		border-radius 50%
		background #63727a

		&.is-on
			background #ff8a2b
			box-shadow 0 0 9px #ff8a2b

	&__key
		padding 1px 5px
		border 1px solid rgba(255, 255, 255, .3)
		border-radius 4px
		font-size 9px
		opacity .7

	&__legend
		display grid
		grid-template-columns repeat(2, minmax(0, 1fr))
		column-gap 16px
		row-gap 6px
		padding 8px 11px
		border 1px solid rgba(255, 255, 255, .18)
		border-radius 8px
		background rgba(5, 13, 18, .82)
		font-size 10px
		white-space nowrap

		span
			display flex
			align-items center
			gap 6px

	&__swatch
		display inline-block
		flex 0 0 auto

		&--control
			width 8px
			height 8px
			border-radius 50%
			background #ff9f43

		&--arc
			width 8px
			height 8px
			border-radius 50%
			background #53c6ff

		&--polygon
			width 12px
			height 2px
			background #ff9f43

		&--path
			width 12px
			height 2px
			background #35d9ff

@media (max-width: 680px)
	.SurfaceRoadHud
		top 10px
		gap 5px
		max-width calc(100vw - 132px)

		// The Road panel's own "Construction view" checkbox covers touch screens,
		// and the collapsed panel sits exactly where this badge would be.
		&__hint,
		&__toggle
			display none

		&__status
			font-size 10px

		&__legend
			box-sizing border-box
			grid-template-columns 1fr
			align-self stretch
			font-size 9px
			white-space normal

.SurfaceRoadSaves
	position fixed
	left calc(12px + var(--sail, 0px))
	bottom calc(12px + var(--saib, 0px))
	z-index 20
	box-sizing border-box
	width unquote('min(272px, calc(100vw - 24px))')
	padding 10px
	border 1px solid rgba(255, 255, 255, .16)
	border-radius 12px
	background rgba(5, 13, 18, .86)
	box-shadow 0 8px 24px rgba(0, 0, 0, .28)
	backdrop-filter blur(8px)
	-webkit-backdrop-filter blur(8px)
	color #f8fbff
	font 500 12px/1.3 system-ui, -apple-system, sans-serif
	user-select none

	&.is-collapsed
		width auto
		padding 8px 10px

	&__header
		display flex
		align-items flex-start
		justify-content space-between
		gap 10px

	&__eyebrow
		margin 0
		font-size 10px
		font-weight 700
		letter-spacing .08em
		text-transform uppercase
		color #7fe6ff

	&__status
		display block
		margin-top 3px
		color rgba(255, 255, 255, .72)
		font-size 11px

	&__collapse
		appearance none
		flex 0 0 auto
		margin 0
		padding 4px 8px
		border 1px solid rgba(255, 255, 255, .28)
		border-radius 999px
		background transparent
		color inherit
		font inherit
		font-size 10px
		letter-spacing .04em
		text-transform uppercase
		cursor pointer

	&__form
		display flex
		gap 6px
		margin 10px 0 8px

	&__field
		flex 1
		min-width 0

		input
			box-sizing border-box
			width 100%
			margin 0
			padding 7px 9px
			border 1px solid rgba(255, 255, 255, .2)
			border-radius 8px
			background rgba(255, 255, 255, .06)
			color inherit
			font inherit
			font-size 12px

			&:focus-visible
				outline 2px solid #fff
				outline-offset 2px

	&__form button,
	&__actions button
		appearance none
		margin 0
		padding 7px 10px
		border 1px solid rgba(104, 225, 255, .5)
		border-radius 8px
		background rgba(5, 13, 18, .4)
		color inherit
		font inherit
		font-weight 700
		font-size 11px
		letter-spacing .04em
		text-transform uppercase
		cursor pointer

		&:hover
			border-color #8cecff

		&:focus-visible
			outline 2px solid #fff
			outline-offset 2px

	&__list
		display flex
		flex-direction column
		gap 4px
		max-height 156px
		margin 0
		padding 0
		overflow auto
		list-style none

		li
			display flex
			gap 4px
			align-items stretch

	&__slot
		appearance none
		flex 1
		min-width 0
		margin 0
		padding 6px 8px
		border 1px solid rgba(255, 255, 255, .12)
		border-radius 8px
		background rgba(255, 255, 255, .04)
		color inherit
		font inherit
		text-align left
		cursor pointer

		strong
			display block
			overflow hidden
			font-size 12px
			text-overflow ellipsis
			white-space nowrap

		span
			display block
			margin-top 2px
			color rgba(255, 255, 255, .62)
			font-size 10px

		&.is-active
			border-color rgba(127, 230, 255, .7)
			background rgba(83, 198, 255, .14)

	&__delete
		appearance none
		flex 0 0 28px
		margin 0
		padding 0
		border 1px solid rgba(255, 93, 108, .45)
		border-radius 8px
		background transparent
		color #ff9aa4
		font 700 14px/1 system-ui, sans-serif
		cursor pointer

	&__empty
		margin 8px 0
		color rgba(255, 255, 255, .62)
		font-size 11px

	&__actions
		display flex
		flex-wrap wrap
		gap 6px
		margin-top 8px

	&__hint
		margin 8px 0 0
		color rgba(255, 255, 255, .55)
		font-size 10px

	&__key
		padding 1px 5px
		border 1px solid rgba(255, 255, 255, .3)
		border-radius 4px
		font-size 9px

	&__sr
		position absolute
		width 1px
		height 1px
		overflow hidden
		clip rect(0, 0, 0, 0)

@media (max-width: 680px)
	.SurfaceRoadSaves
		left calc(8px + var(--sail, 0px))
		bottom calc(8px + var(--saib, 0px))
		width unquote('min(calc(100vw - 16px), 272px)')
</style>
