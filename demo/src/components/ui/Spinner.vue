<!-- Modern style Spinner for infinite loading by @makio64-->
<template>
	<div class="Spinner" :class="{ blue: color == 'blue' }" />
</template>

<script>
export default {
	name: 'Spinner',
	props: {
		color: {
			type: String,
			default: 'red',
		},
	},
}
</script>

<style lang="stylus" scoped>
.Spinner
	margin auto
	width: 74px;
	height: 74px;
	border-radius: 50%;
	background: radial-gradient(farthest-side,#ff5379 94%,#0000) top/9px 9px no-repeat, conic-gradient(#0000 30%,#ff5379);
	-webkit-mask: radial-gradient(farthest-side,#0000 calc(100% - 9px),#000 0);
	animation: spinner-c7wet2 1s infinite linear;
	&.blue
		background: radial-gradient(farthest-side,#0097FE 94%,#0000) top/9px 9px no-repeat,conic-gradient(#0000 30%,#0097FE);

@keyframes spinner-c7wet2 {
   100% {
      transform: rotate(1turn);
   }
}
</style>
