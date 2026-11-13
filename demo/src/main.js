// Before the router: its navigate listener has to be added first (see the module).
import '@/utils/silentUrl'

import { TinyRouterInstall } from 'vue-tiny-router'
import TranslatePlugin from 'vue-tiny-translation'

import App from '@/App.vue'

async function init() {
	const app = createApp( App )

	app.use( TranslatePlugin )
	app.use( TinyRouterInstall )
	app.mount( '#app' )
}
init()
