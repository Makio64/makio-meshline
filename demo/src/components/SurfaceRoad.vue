<template>
	<div class="SurfaceRoadHud" @pointerdown.stop>
		<div class="SurfaceRoadHud__bar" role="toolbar" aria-label="Road controls">
			<button
				class="SurfaceRoadHud__btn"
				type="button"
				@click="resetRoad"
			>Valley</button>
			<button
				class="SurfaceRoadHud__btn"
				type="button"
				@click="elevatedPreset"
			>3D Overpass</button>
			<button
				class="SurfaceRoadHud__btn"
				type="button"
				title="Generate random road (R)"
				@click="randomRoad"
			>Random</button>
			<span class="SurfaceRoadHud__divider" aria-hidden="true" />
			<button
				class="SurfaceRoadHud__btn"
				:class="{ 'is-active': ui.wireframe }"
				type="button"
				:aria-pressed="ui.wireframe"
				title="Toggle wireframe (W)"
				@click="toggleWireframe"
			>Wireframe</button>
			<button
				v-if="ui.controls > 2"
				class="SurfaceRoadHud__btn SurfaceRoadHud__btn--danger"
				type="button"
				title="Delete selected point (Delete / Backspace)"
				@click="removeSelected"
			>Delete</button>
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
		<button
			v-if="!savesOpen"
			class="SurfaceRoadSaves__trigger"
			type="button"
			:aria-expanded="savesOpen"
			aria-label="Expand saved roads"
			@click="savesOpen = true"
		>
			<span>Saves</span>
			<span v-if="ui.saves.length" class="SurfaceRoadSaves__badge">{{ ui.saves.length }}</span>
		</button>

		<div v-else class="SurfaceRoadSaves__panel">
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
					@click="savesOpen = false"
				>Close</button>
			</header>

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
				<button class="SurfaceRoadSaves__pillBtn" type="submit">Save</button>
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
				<button class="SurfaceRoadSaves__actionBtn" type="button" @click="exportRoad">Export</button>
				<button class="SurfaceRoadSaves__actionBtn" type="button" @click="importRoad">Import</button>
				<button class="SurfaceRoadSaves__actionBtn" type="button" @click="copyLink">Copy link</button>
			</div>
		</div>
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
			if ( key === 'w' || key === 'W' ) this.toggleWireframe()
			else if ( key === 'r' || key === 'R' ) this.randomRoad()
			else if ( key === 'Backspace' || key === 'Delete' ) {
				event?.preventDefault?.()
				this.removeSelected()
			}
		},
		toggleWireframe() {
			this.api.toggleWireframe()
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
	top calc( 18px + var( --sait, 0px ) )
	transform translateX( -50% )
	z-index 20
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

		&:hover,
		&:focus-visible
			background rgba( 255, 255, 255, 0.1 )
			color #ffffff
			outline none

		&.is-active
			background rgba( 255, 255, 255, 0.16 )
			color #ffffff

		&--danger
			color rgba( 255, 162, 171, 0.88 )

			&:hover,
			&:focus-visible
				background rgba( 255, 93, 108, 0.18 )
				color #ffd4d9

.SurfaceRoadSaves
	position fixed
	left calc( 18px + var( --sail, 0px ) )
	bottom calc( 18px + var( --saib, 0px ) )
	z-index 20
	color rgba( 244, 245, 247, 0.86 )
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	user-select none

	&__trigger
		appearance none
		box-sizing border-box
		display inline-flex
		align-items center
		justify-content center
		gap 6px
		min-height 40px
		margin 0
		padding 4px 14px
		border-radius 999px
		background rgba( 8, 9, 12, 0.7 )
		border 1px solid rgba( 255, 255, 255, 0.1 )
		box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
		backdrop-filter blur( 14px )
		-webkit-backdrop-filter blur( 14px )
		color rgba( 244, 245, 247, 0.78 )
		font inherit
		cursor pointer
		transition background 0.16s ease, border-color 0.16s ease, color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba( 20, 23, 32, 0.86 )
			border-color rgba( 255, 255, 255, 0.24 )
			color #ffffff
			outline none

	&__badge
		display inline-flex
		align-items center
		justify-content center
		min-width 18px
		height 18px
		padding 0 5px
		border-radius 999px
		background rgba( 255, 255, 255, 0.12 )
		color rgba( 244, 245, 247, 0.9 )
		font-size 11px

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

		&__bar
			padding 3px 5px

		&__btn
			padding 0 8px

	.SurfaceRoadSaves
		left calc( 12px + var( --sail, 0px ) )
		bottom calc( 12px + var( --saib, 0px ) )

		&__trigger
			min-height 38px
			padding 0 12px

@media (prefers-reduced-motion: reduce)
	.SurfaceRoadHud__btn,
	.SurfaceRoadSaves__trigger,
	.SurfaceRoadSaves__close,
	.SurfaceRoadSaves__pillBtn,
	.SurfaceRoadSaves__actionBtn,
	.SurfaceRoadSaves__slot,
	.SurfaceRoadSaves__delete
		transition none
</style>
