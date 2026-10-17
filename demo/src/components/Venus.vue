<template>
	<div class="morph-ui" role="group" aria-label="Sculpture morph target" @pointerdown.stop>
		<div class="buttons">
			<button
				type="button"
				:class="{ active: selectedGender === 'man', man: true }"
				:aria-pressed="String( selectedGender === 'man' )"
				title="Morph to David"
				@click="onMan"
			>
				<span class="dot" aria-hidden="true" />
				<span>David</span>
			</button>
			<button
				type="button"
				:class="{ active: selectedGender === 'woman', woman: true }"
				:aria-pressed="String( selectedGender === 'woman' )"
				title="Morph to Venus"
				@click="onWoman"
			>
				<span class="dot" aria-hidden="true" />
				<span>Venus</span>
			</button>
		</div>
	</div>
</template>

<script>
export default {
	name: 'VenusUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			selectedGender: 'man',
		}
	},
	mounted() {
		const m = this.api?.morph?.value ?? 0
		this.selectedGender = m >= 0.5 ? 'woman' : 'man'
	},
	methods: {
		onMan() {
			this.selectedGender = 'man'
			this.api?.david?.()
		},
		onWoman() {
			this.selectedGender = 'woman'
			this.api?.venus?.()
		},
	},
}
</script>

<style lang="stylus" scoped>
.morph-ui
	position fixed
	top calc( 18px + var( --sait, 0px ) )
	left 50%
	transform translateX( -50% )
	max-width 260px
	display inline-flex
	align-items center
	padding 4px
	border-radius 999px
	background rgba( 8, 9, 12, 0.72 )
	border 1px solid rgba( 255, 255, 255, 0.12 )
	box-shadow 0 12px 30px rgba( 0, 0, 0, 0.32 )
	backdrop-filter blur( 14px )
	-webkit-backdrop-filter blur( 14px )
	z-index 1000
	font 650 11px/1 'Inter', system-ui, -apple-system, sans-serif
	letter-spacing 0.06em
	text-transform uppercase
	user-select none

	.buttons
		display inline-flex
		align-items center
		gap 3px

	button
		appearance none
		display inline-flex
		align-items center
		gap 6px
		min-height 30px
		margin 0
		padding 0 13px
		border 1px solid transparent
		border-radius 999px
		background transparent
		color rgba( 244, 245, 247, 0.68 )
		font inherit
		letter-spacing inherit
		text-transform inherit
		cursor pointer
		transition background 0.16s ease, color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease

		.dot
			width 6px
			height 6px
			border-radius 50%
			background currentColor
			opacity 0.55

		&:hover
			color #ffffff
			background rgba( 255, 255, 255, 0.07 )

		&.man.active
			color #fff7e6
			background rgba( 251, 146, 60, 0.22 )
			border-color rgba( 251, 146, 60, 0.52 )
			box-shadow 0 0 16px rgba( 251, 146, 60, 0.2 )

			.dot
				background #fb923c
				box-shadow 0 0 8px #fb923c
				opacity 1

		&.woman.active
			color #fdf2f8
			background rgba( 244, 114, 182, 0.22 )
			border-color rgba( 244, 114, 182, 0.52 )
			box-shadow 0 0 16px rgba( 244, 114, 182, 0.2 )

			.dot
				background #f472b6
				box-shadow 0 0 8px #f472b6
				opacity 1

@media (max-width: 640px)
	.morph-ui
		top calc( 12px + var( --sait, 0px ) )
		max-width calc( 100vw - 112px )
		padding 3px

		button
			min-height 27px
			padding 0 10px
			font-size 10px
</style>
