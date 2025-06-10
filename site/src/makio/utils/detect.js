/**
 * A utility class to detect various properties of the browser and device.
 * isMobile / browsers / devices / default lang / landscape / fullscreen / local
 * @author Makio64 | David Ronai
 */

// Devices
var userAgent = navigator.userAgent || navigator.vendor || window.opera
export const isWindowsPhone = /windows phone/i.test( userAgent )
export const isAndroid = /android/i.test( userAgent )
export const isIOS = /iPad|iPhone|iPod/.test( userAgent ) && !window.MSStream
export const isMac = navigator.platform.toUpperCase().indexOf( 'MAC' ) >= 0

// isMobile & isDesktop
export const isMobile = isWindowsPhone || isAndroid || isIOS
export const isDesktop = !isMobile

// https://gist.github.com/leipert/9586b796281faa5e27ed?permalink_comment_id=2962471#gistcomment-2962471
export function detectLang( availableLanguages = ['en', 'fr'] ) {
	var locale =
		[...( window.navigator.languages || [] ), window.navigator.language, window.navigator.browserLanguage, window.navigator.userLanguage, window.navigator.systemLanguage]
			.filter( Boolean )
			.map( ( language ) => language.substr( 0, 2 ) )
			.find( ( language ) => availableLanguages.includes( language ) ) || 'en'
	return locale
}

// https://stackoverflow.com/questions/9847580/how-to-detect-safari-chrome-ie-firefox-and-opera-browser
export const isOpera = ( !!window.opr && !!window.opr.addons ) || !!window.opera || navigator.userAgent.indexOf( ' OPR/' ) >= 0
export const isFirefox = navigator.userAgent.toLowerCase().includes( 'firefox' )
export const isSafari =
	/constructor/i.test( window.HTMLElement ) ||
	( function ( p ) {
		return p.toString() === '[object SafariRemoteNotification]'
	} )( !window['safari'] || ( typeof window.safari !== 'undefined' && window.safari.pushNotification ) )
export const isIE = /*@cc_on!@*/ false || !!document.documentMode // But who care ? :)
export const isEdge = /Edg/.test( navigator.userAgent )
export const isChrome = !!window.chrome && ( !!window.chrome.webstore || !!window.chrome.runtime )
export const isBrave = navigator.brave ? true : false

export const isLandscape = () => window.innerWidth > window.innerHeight
export const isFullScreen = () => !!( document.fullScreen || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement )

export const isLocal = window.location.href.indexOf( 'localhost' ) >= 0 || window.location.href.indexOf( '192.168.' ) >= 0
