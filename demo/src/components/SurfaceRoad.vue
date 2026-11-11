<template>
	<div class="SurfaceRoadHud" @pointerdown.stop>
		<div class="SurfaceRoadHud__bar" role="toolbar" aria-label="Road controls">
			<div class="SurfaceRoadHud__views" role="group" aria-label="View">
				<button
					v-for="view in views"
					:key="view.id"
					class="SurfaceRoadHud__btn"
					:class="{ 'is-active': ui.view === view.id }"
					type="button"
					:aria-pressed="ui.view === view.id"
					:disabled="view.id !== 'edit' && !ui.cars"
					:title="view.title"
					@click="api.setView( view.id )"
				>{{ view.label }}</button>
			</div>
			<span class="SurfaceRoadHud__divider" aria-hidden="true" />
			<button class="SurfaceRoadHud__btn" type="button" @click="api.resetRoad()">Valley</button>
			<button class="SurfaceRoadHud__btn" type="button" @click="api.setElevatedPreset()">3D Overpass</button>
			<span class="SurfaceRoadHud__divider" aria-hidden="true" />
			<button
				class="SurfaceRoadHud__btn"
				:class="{ 'is-active': ui.wireframe }"
				type="button"
				:aria-pressed="ui.wireframe"
				title="Toggle wireframe (W)"
				@click="api.toggleWireframe()"
			>Wireframe</button>
			<button
				class="SurfaceRoadHud__btn"
				:class="{ 'is-active': ui.structure !== 'none' }"
				type="button"
				:aria-label="`Structure: ${structureLabel}`"
				title="What is built around the road: none, simple or complex (B)"
				@click="api.cycleStructure()"
			>Structure<small>{{ structureLabel }}</small></button>
			<button
				class="SurfaceRoadHud__btn"
				:class="{ 'is-active': ui.sound }"
				type="button"
				:aria-pressed="ui.sound"
				title="Interface sounds"
				@click="api.toggleSound()"
			>Sound<small>{{ ui.sound ? 'On' : 'Off' }}</small></button>
			<template v-if="!hideSaves">
				<span class="SurfaceRoadHud__divider" aria-hidden="true" />
				<button
					class="SurfaceRoadHud__btn SurfaceRoadSaves__trigger"
					:class="{ 'is-active': savesOpen }"
					type="button"
					:aria-expanded="savesOpen"
					:aria-label="savesOpen ? 'Collapse saved roads' : 'Expand saved roads'"
					@click="toggleSaves( !savesOpen )"
				>
					<span>Saves</span>
					<span v-if="ui.saves.length" class="SurfaceRoadSaves__badge">{{ ui.saves.length }}</span>
				</button>
			</template>
		</div>
		<p v-if="issue" class="SurfaceRoadHud__issue" role="status">
			<strong>{{ issue.title }}</strong>
			<span>{{ issue.advice }}</span>
		</p>
	</div>

	<aside
		v-if="ui.view === 'edit' && ui.controls"
		class="SurfaceRoadPoint"
		:class="`is-${ui.point.status}`"
		aria-label="Selected point"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<header class="SurfaceRoadPoint__header">
			<span class="SurfaceRoadPoint__swatch" aria-hidden="true" />
			<span class="SurfaceRoadPoint__title">Point {{ ui.point.index + 1 }}<small> / {{ ui.controls }}</small></span>
			<span class="SurfaceRoadPoint__status">{{ statusLabel }}</span>
			<button
				class="SurfaceRoadPoint__delete"
				type="button"
				:disabled="ui.controls <= minLoop"
				title="Delete selected point (Delete / Backspace)"
				@click="api.removeSelectedControl()"
			>Delete</button>
		</header>
		<label class="SurfaceRoadPoint__row SurfaceRoadPoint__row--height">
			<span>Height</span>
			<input
				type="range"
				:min="minHeight"
				:max="maxHeight"
				step="0.1"
				:value="ui.point.height"
				:style="{ '--slider-progress': progress( ui.point.height, minHeight, maxHeight ) }"
				:aria-valuetext="`${heightLabel} above the ground`"
				@input="api.setPointHeight( Number( $event.target.value ) )"
			>
			<output>{{ heightLabel }}</output>
		</label>
		<label class="SurfaceRoadPoint__row SurfaceRoadPoint__row--bank">
			<span>Bank</span>
			<input
				type="range"
				:min="-maxBank"
				:max="maxBank"
				step="1"
				:value="bankDegrees"
				:style="{ '--slider-progress': progress( bankDegrees, -maxBank, maxBank ) }"
				:aria-valuetext="`${bankDegrees} degrees`"
				@input="api.setPointBank( Number( $event.target.value ) )"
			>
			<output>{{ bankDegrees }}°</output>
		</label>
		<p class="SurfaceRoadPoint__hint">Drag a point to move it. Double-click to add one, right-click to remove it. Shift-drag the ground to pan.</p>
	</aside>

	<div
		v-else-if="ui.view !== 'edit'"
		class="SurfaceRoadRide"
		role="group"
		aria-label="Car"
		@pointerdown.stop
	>
		<button class="SurfaceRoadRide__step" type="button" aria-label="Previous car" @click="api.stepCar( -1 )">‹</button>
		<span class="SurfaceRoadRide__car">Car {{ ui.car % ui.cars + 1 }}<small> / {{ ui.cars }}</small></span>
		<button class="SurfaceRoadRide__step" type="button" aria-label="Next car" title="Next car (N)" @click="api.stepCar( 1 )">›</button>
		<span class="SurfaceRoadRide__speed"><strong>{{ ui.speed }}</strong> km/h</span>
	</div>

	<aside
		v-if="savesOpen"
		class="SurfaceRoadSaves"
		aria-label="Saved roads"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<div class="SurfaceRoadSaves__panel">
			<header class="SurfaceRoadSaves__header">
				<div class="SurfaceRoadSaves__heading">
					<span class="SurfaceRoadSaves__title">Saves</span>
					<span class="SurfaceRoadSaves__status" aria-live="polite">
						{{ ui.saveMessage || (ui.storageAvailable ? 'Autosaved' : 'Storage blocked') }}
					</span>
				</div>
				<button
					class="SurfaceRoadSaves__close"
					type="button"
					:aria-expanded="savesOpen"
					aria-label="Collapse saved roads"
					@click="toggleSaves( false )"
				>Close</button>
			</header>

			<form class="SurfaceRoadSaves__form" @submit.prevent="api.saveNamedRoad( ui.saveName )">
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
				<button class="SurfaceRoadSaves__pillBtn" type="submit">Save</button>
			</form>

			<ul v-if="ui.saves.length" class="SurfaceRoadSaves__list">
				<li v-for="save in ui.saves" :key="save.id">
					<button
						class="SurfaceRoadSaves__slot"
						type="button"
						:class="{ 'is-active': save.id === ui.activeSaveId }"
						@click="api.loadSavedRoad( save.id )"
					>
						<strong>{{ save.name }}</strong>
						<span>{{ save.points }} pts · {{ formatSavedAt( save.savedAt ) }}</span>
					</button>
					<button
						v-if="!save.autosave"
						class="SurfaceRoadSaves__delete"
						type="button"
						:aria-label="`Delete ${save.name}`"
						@click.stop="api.deleteSavedRoad( save.id )"
					>×</button>
				</li>
			</ul>
			<p v-else class="SurfaceRoadSaves__empty">Edit the road to autosave, or save a named copy.</p>

			<div class="SurfaceRoadSaves__actions">
				<button class="SurfaceRoadSaves__actionBtn" type="button" @click="api.exportRoadFile()">Export</button>
				<button class="SurfaceRoadSaves__actionBtn" type="button" @click="api.importRoadFile()">Import</button>
				<button class="SurfaceRoadSaves__actionBtn" type="button" @click="api.copyShareLink()">Copy link</button>
			</div>
		</div>
	</aside>
</template>

<script>
import stage3d from '@/makio/three/stage3d'
import { noUI } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'
import { onShortcut } from '@/utils/demoControls'
import { MAX_CLEARANCE, MIN_CLEARANCE, MIN_LOOP } from '@/utils/surfaceRoadRoute'

const VIEWS = [
	{ id: 'edit', label: 'Edit', title: 'Edit the road (Esc)' },
	{ id: 'follow', label: 'Follow', title: 'Follow a car, or click one (C for the next view)' },
	{ id: 'drive', label: 'Drive', title: 'Sit in the driver’s seat (C for the next view)' },
]
const STATUS_LABELS = { smooth: 'Smooth', corner: 'Rounded corner', tight: 'Too tight' }
const STRUCTURE_LABELS = { none: 'None', simple: 'Simple', complex: 'Complex' }
const ISSUES = {
	tight: { title: 'Too tight to build.', advice: 'The road keeps its last shape: give the red point more room to turn, or less bank over a crest.' },
	folded: { title: 'Too tight to build.', advice: 'The road folds at the red point: give it more room to turn, or less bank over a crest.' },
	unbuildable: { title: 'This route cannot be built.', advice: 'The road keeps its last shape.' },
}

export default {
	name: 'SurfaceRoadUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			savesOpen: false,
			hideSaves: noUI,
			views: VIEWS,
			minHeight: MIN_CLEARANCE,
			maxHeight: MAX_CLEARANCE,
			maxBank: 45,
			minLoop: MIN_LOOP,
		}
	},
	computed: {
		ui() {
			return this.api.ui
		},
		issue() {
			return ISSUES[this.ui.issue]
		},
		statusLabel() {
			return STATUS_LABELS[this.ui.point.status]
		},
		structureLabel() {
			return STRUCTURE_LABELS[this.ui.structure]
		},
		heightLabel() {
			// Rounded first, so a hair under the ground does not read as -0.0.
			return `${( Math.round( this.ui.point.height * 10 ) / 10 || 0 ).toFixed( 1 )} m`
		},
		bankDegrees() {
			return Math.round( this.ui.point.bank * 180 / Math.PI )
		},
	},
	mounted() {
		onShortcut( 'w', () => this.api.toggleWireframe() )
		onShortcut( 'b', () => this.api.cycleStructure() )
		onShortcut( 'c', () => this.api.cycleView() )
		onShortcut( 'n', () => this.api.stepCar( 1 ) )
		onShortcut( 'Escape', () => this.api.setView( 'edit' ) )
		stage3d.listen( keyboard.onDown, this.onKey )
	},
	methods: {
		// These keys have a browser default to stop, which onShortcut leaves alone.
		onKey( key, event ) {
			if ( event.repeat || event.defaultPrevented || menuOpen.value ) return
			if ( ( event.ctrlKey || event.metaKey ) && key.toLowerCase() === 's' ) {
				event.preventDefault()
				this.api.saveNamedRoad( this.ui.saveName )
				return
			}
			if ( key !== 'Backspace' && key !== 'Delete' ) return
			if ( event.altKey || event.ctrlKey || event.metaKey ) return
			if ( event.target.matches?.( 'input, textarea, select, [contenteditable="true"]' ) ) return
			event.preventDefault()
			this.api.removeSelectedControl()
		},
		toggleSaves( open ) {
			this.savesOpen = open
			this.api.playClick()
		},
		progress( value, min, max ) {
			return `${Math.max( 0, Math.min( 100, ( value - min ) / ( max - min ) * 100 ) ).toFixed( 1 )}%`
		},
		formatSavedAt( value ) {
			const time = Date.parse( value )
			if ( !Number.isFinite( time ) ) return 'just now'
			const elapsed = Date.now() - time
			if ( elapsed < 15000 ) return 'just now'
			if ( elapsed < 60000 ) return `${Math.round( elapsed / 1000 )}s ago`
			if ( elapsed < 3600000 ) return `${Math.round( elapsed / 60000 )}m ago`
			if ( elapsed < 86400000 ) return `${Math.round( elapsed / 3600000 )}h ago`
			return `${Math.round( elapsed / 86400000 )}d ago`
		},
	},
}
</script>

<style lang="stylus" scoped>
.SurfaceRoadHud
	position fixed
	left 50%
	top calc( 18px + var( --sait, 0px ) )
	transform translateX( -50% )
	z-index 20
	// Fit the bar rather than the half of the viewport that `left 50%` leaves.
	width max-content
	max-width calc( 100vw - 36px )
	color rgba( 244, 245, 247, 0.86 )
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	user-select none

	&__bar
		display inline-flex
		flex-wrap wrap
		align-items center
		justify-content center
		gap 2px
		padding 4px 6px
		border-radius 999px
		background rgba( 8, 9, 12, 0.7 )
		border 1px solid rgba( 255, 255, 255, 0.1 )
		box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
		backdrop-filter blur( 14px )
		-webkit-backdrop-filter blur( 14px )

	&__divider
		width 1px
		height 16px
		margin 0 3px
		background rgba( 255, 255, 255, 0.12 )

	&__btn
		appearance none
		display inline-flex
		align-items center
		justify-content center
		gap 5px
		min-height 30px
		margin 0
		padding 0 10px
		border 0
		border-radius 999px
		background transparent
		color rgba( 244, 245, 247, 0.72 )
		font inherit
		cursor pointer
		transition background 0.16s ease, color 0.16s ease

		// The level a button is on, beside its name.
		small
			font-size 11px
			opacity 0.6

		&:hover,
		&:focus-visible
			background rgba( 255, 255, 255, 0.1 )
			color #ffffff
			outline none

		&.is-active
			background rgba( 255, 255, 255, 0.16 )
			color #ffffff

		&:disabled
			opacity 0.4
			cursor default

	// The three views read as one switch.
	&__views
		display inline-flex
		gap 2px
		padding 2px
		border-radius 999px
		background rgba( 255, 255, 255, 0.06 )

		.SurfaceRoadHud__btn
			min-height 26px

			&.is-active
				background #f4f5f7
				color #0b0d11

	&__issue
		display flex
		flex-wrap wrap
		align-items baseline
		justify-content center
		gap 2px 6px
		box-sizing border-box
		max-width 430px
		margin 8px auto 0
		padding 8px 14px
		border-radius 14px
		background rgba( 46, 10, 16, 0.84 )
		border 1px solid rgba( 255, 77, 94, 0.5 )
		box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
		backdrop-filter blur( 14px )
		-webkit-backdrop-filter blur( 14px )
		color rgba( 255, 226, 229, 0.86 )
		font-size 11.5px
		line-height 1.35
		text-align center

		strong
			color #ff8591
			font-weight 600

// The selected point, bottom left: what it is, and the two values its gizmo drags.
.SurfaceRoadPoint,
.SurfaceRoadRide
	position fixed
	left calc( 18px + var( --sail, 0px ) )
	bottom calc( 18px + var( --saib, 0px ) )
	z-index 20
	box-sizing border-box
	background rgba( 8, 9, 12, 0.74 )
	border 1px solid rgba( 255, 255, 255, 0.1 )
	box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
	backdrop-filter blur( 14px )
	-webkit-backdrop-filter blur( 14px )
	color rgba( 244, 245, 247, 0.86 )
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	user-select none

	small
		color rgba( 244, 245, 247, 0.46 )
		font-size inherit

.SurfaceRoadPoint
	--point-color #ff9f43
	width 252px
	padding 10px 12px 11px
	border-radius 16px

	&.is-corner
		--point-color #53c6ff

	&.is-tight
		--point-color #ff4d5e

	&__header
		display flex
		align-items center
		gap 7px
		min-height 24px
		margin-bottom 8px

	// The handle itself, in small: status colour inside a white ring.
	&__swatch
		flex 0 0 auto
		width 8px
		height 8px
		border 2px solid #ffffff
		border-radius 50%
		background var( --point-color )
		box-shadow 0 0 0 1px rgba( 18, 21, 26, 0.9 )

	&__title
		color rgba( 244, 245, 247, 0.96 )
		font-weight 600

	&__status
		flex 1
		overflow hidden
		color var( --point-color )
		font-size 11px
		text-overflow ellipsis
		white-space nowrap

	&__delete
		appearance none
		min-height 24px
		margin 0
		padding 0 9px
		border 0
		border-radius 999px
		background rgba( 255, 255, 255, 0.07 )
		color rgba( 255, 162, 171, 0.9 )
		font inherit
		font-size 11px
		cursor pointer
		transition background 0.16s ease, color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba( 255, 93, 108, 0.2 )
			color #ffd4d9
			outline none

		&:disabled
			opacity 0.35
			cursor default

	// Each row wears the colour of the gizmo that drags the same value.
	&__row
		--row-color #62e88a
		display grid
		grid-template-columns 44px 1fr 46px
		align-items center
		gap 8px
		min-height 26px
		cursor pointer

		&--bank
			--row-color #53c6ff

		span
			color rgba( 244, 245, 247, 0.62 )
			font-size 11px

		output
			color rgba( 244, 245, 247, 0.96 )
			font-size 11px
			font-weight 600
			text-align right

		input
			--slider-track-size 4px
			--slider-thumb-size 13px
			appearance none
			touch-action pan-x
			width 100%
			height 18px
			margin 0
			padding 0
			border 0
			background transparent
			cursor pointer

			&::-webkit-slider-runnable-track
				height var( --slider-track-size )
				border-radius 999px
				background linear-gradient( to right, var( --row-color ) 0 var( --slider-progress ), rgba( 255, 255, 255, 0.14 ) var( --slider-progress ) 100% )

			&::-webkit-slider-thumb
				-webkit-appearance none
				appearance none
				width var( --slider-thumb-size )
				height var( --slider-thumb-size )
				margin-top calc( ( var( --slider-track-size ) - var( --slider-thumb-size ) ) / 2 )
				border 2px solid var( --row-color )
				border-radius 50%
				background #f8fafc
				box-shadow 0 2px 6px rgba( 0, 0, 0, 0.4 )

			&::-moz-range-track
				height var( --slider-track-size )
				border-radius 999px
				background rgba( 255, 255, 255, 0.14 )

			&::-moz-range-progress
				height var( --slider-track-size )
				border-radius 999px
				background var( --row-color )

			&::-moz-range-thumb
				width var( --slider-thumb-size )
				height var( --slider-thumb-size )
				border 2px solid var( --row-color )
				border-radius 50%
				background #f8fafc
				box-shadow 0 2px 6px rgba( 0, 0, 0, 0.4 )

			&:focus-visible
				outline 2px solid var( --row-color )
				outline-offset 3px

	&__hint
		margin 8px 0 0
		padding-top 8px
		border-top 1px solid rgba( 255, 255, 255, 0.08 )
		color rgba( 244, 245, 247, 0.5 )
		font-size 10.5px
		line-height 1.4

.SurfaceRoadRide
	display inline-flex
	align-items center
	gap 4px
	min-height 40px
	padding 4px 14px 4px 5px
	border-radius 999px

	&__step
		appearance none
		width 30px
		height 30px
		margin 0
		padding 0 0 2px
		border 0
		border-radius 50%
		background transparent
		color rgba( 244, 245, 247, 0.72 )
		font 500 17px/1 'Inter', system-ui, sans-serif
		cursor pointer
		transition background 0.16s ease, color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba( 255, 255, 255, 0.1 )
			color #ffffff
			outline none

	&__car
		min-width 54px
		color rgba( 244, 245, 247, 0.96 )
		font-weight 600
		text-align center

	&__speed
		margin-left 8px
		padding-left 12px
		border-left 1px solid rgba( 255, 255, 255, 0.12 )
		color rgba( 244, 245, 247, 0.56 )
		font-size 11px

		strong
			display inline-block
			min-width 20px
			color rgba( 244, 245, 247, 0.96 )
			font-size 13px
			font-weight 600
			text-align right

.SurfaceRoadSaves
	position fixed
	left 50%
	top calc( 64px + var( --sait, 0px ) )
	transform translateX( -50% )
	z-index 20
	color rgba( 244, 245, 247, 0.86 )
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	user-select none

	&__badge
		display inline-flex
		align-items center
		justify-content center
		min-width 16px
		height 16px
		padding 0 4px
		border-radius 999px
		background rgba( 255, 255, 255, 0.14 )
		color rgba( 244, 245, 247, 0.92 )
		font-size 10px

	&__panel
		box-sizing border-box
		width unquote( 'min(264px, calc(100vw - 36px))' )
		padding 10px
		border-radius 18px
		background rgba( 8, 9, 12, 0.76 )
		border 1px solid rgba( 255, 255, 255, 0.1 )
		box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
		backdrop-filter blur( 14px )
		-webkit-backdrop-filter blur( 14px )

	&__header
		display flex
		align-items center
		justify-content space-between
		gap 8px
		padding 2px 4px 8px

	&__heading
		display flex
		flex-direction column
		gap 3px
		min-width 0

	&__title
		color rgba( 244, 245, 247, 0.94 )
		font-size 12px
		font-weight 600

	&__status
		overflow hidden
		color rgba( 244, 245, 247, 0.56 )
		font-size 11px
		text-overflow ellipsis
		white-space nowrap

	&__close,
	&__pillBtn,
	&__actionBtn
		appearance none
		display inline-flex
		align-items center
		justify-content center
		min-height 28px
		margin 0
		padding 0 10px
		border 0
		border-radius 999px
		background rgba( 255, 255, 255, 0.08 )
		color rgba( 244, 245, 247, 0.78 )
		font inherit
		font-size 11px
		cursor pointer
		transition background 0.16s ease, color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba( 255, 255, 255, 0.16 )
			color #ffffff
			outline none

	&__form
		display flex
		align-items center
		gap 4px
		padding 3px
		border-radius 999px
		background rgba( 255, 255, 255, 0.05 )
		border 1px solid rgba( 255, 255, 255, 0.08 )

	&__field
		flex 1
		min-width 0

		input
			box-sizing border-box
			width 100%
			margin 0
			padding 5px 10px
			border 0
			border-radius 999px
			background transparent
			color #ffffff
			font inherit
			font-size 12px

			&::placeholder
				color rgba( 244, 245, 247, 0.42 )

			&:focus-visible
				outline none

	&__list
		display flex
		flex-direction column
		gap 4px
		max-height 148px
		margin 8px 0 0
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
		padding 7px 10px
		border 1px solid transparent
		border-radius 10px
		background rgba( 255, 255, 255, 0.04 )
		color inherit
		font inherit
		text-align left
		cursor pointer
		transition background 0.16s ease, border-color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba( 255, 255, 255, 0.09 )
			outline none

		strong
			display block
			overflow hidden
			color rgba( 244, 245, 247, 0.92 )
			font-size 12px
			font-weight 500
			text-overflow ellipsis
			white-space nowrap

		span
			display block
			margin-top 3px
			color rgba( 244, 245, 247, 0.52 )
			font-size 10px

		&.is-active
			border-color rgba( 255, 255, 255, 0.2 )
			background rgba( 255, 255, 255, 0.11 )

	&__delete
		appearance none
		flex 0 0 28px
		margin 0
		padding 0
		border 0
		border-radius 10px
		background rgba( 255, 255, 255, 0.04 )
		color rgba( 244, 245, 247, 0.56 )
		font 500 14px/1 'Inter', system-ui, sans-serif
		cursor pointer
		transition background 0.16s ease, color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba( 255, 93, 108, 0.18 )
			color #ffd4d9
			outline none

	&__empty
		margin 8px 4px 0
		color rgba( 244, 245, 247, 0.52 )
		font-size 11px
		line-height 1.35

	&__actions
		display flex
		align-items center
		gap 2px
		margin-top 8px
		padding 3px
		border-radius 999px
		background rgba( 255, 255, 255, 0.04 )
		border 1px solid rgba( 255, 255, 255, 0.07 )

	&__actionBtn
		flex 1
		background transparent

	&__sr
		position absolute
		width 1px
		height 1px
		overflow hidden
		clip rect( 0, 0, 0, 0 )

@media (max-width: 640px)
	.SurfaceRoadHud
		top calc( 12px + var( --sait, 0px ) )
		max-width calc( 100vw - 112px )

		// The bar wraps here: the view switch takes the first row, and rows of buttons do not make a pill.
		&__bar
			padding 4px
			border-radius 20px

		&__divider
			display none

		&__views
			flex 1 0 100%

			.SurfaceRoadHud__btn
				flex 1

		&__btn
			padding 0 8px

	.SurfaceRoadSaves
		left calc( 12px + var( --sail, 0px ) )
		bottom calc( 12px + var( --saib, 0px ) )

		&__trigger
			min-height 38px
			padding 0 12px

	// Above the demo navigation, which owns the bottom edge of a narrow screen.
	.SurfaceRoadPoint,
	.SurfaceRoadRide
		left calc( 12px + var( --sail, 0px ) )
		bottom calc( 64px + var( --saib, 0px ) )

	.SurfaceRoadPoint
		width unquote( 'min(252px, calc(100vw - 24px))' )

		&__hint
			display none

@media (prefers-reduced-motion: reduce)
	.SurfaceRoadHud__btn,
	.SurfaceRoadPoint__delete,
	.SurfaceRoadRide__step,
	.SurfaceRoadSaves__close,
	.SurfaceRoadSaves__pillBtn,
	.SurfaceRoadSaves__actionBtn,
	.SurfaceRoadSaves__slot,
	.SurfaceRoadSaves__delete
		transition none
</style>
