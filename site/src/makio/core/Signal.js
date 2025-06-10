import DoubleLinkedList from '../utils/structures/DoubleLinkedList'
import ObjectPool from '../utils/structures/ObjectPool'

class SignalNode {
	constructor() {
		this.prev = null
		this.next = null
		this.listener = null
	}
}

export default class Signal {
	static POOL = new ObjectPool( () => new SignalNode(), 256 )

	constructor() {
		this.listeners = new DoubleLinkedList()
		this.listenersOnce = []
	}

	add( listener ) {
		const node = Signal.POOL.get()
		node.listener = listener
		listener.__signalNode = node

		this.listeners.add( node )
	}

	remove( listener ) {
		if ( !listener.__signalNode ) {
			return
		}
		this.listeners.remove( listener.__signalNode )
		Signal.POOL.release( listener.__signalNode )
		listener.__signalNode = null
	}

	once( listener ) {
		this.addOnce( listener )
	}

	addOnce( listener ) {
		this.listenersOnce.push( listener )
	}

	dispatch() {
		const n = this.listenersOnce.length
		if ( n > 0 ) {
			for ( let i = 0; i < n; i++ ) {
				this.listenersOnce[i].apply( null, arguments )
			}
			this.listenersOnce = []
		}

		let node = this.listeners.root
		while ( node ) {
			node.listener.apply( null, arguments )
			node = node.next
		}
	}

	dispose() {
		let node = this.listeners.root
		while ( node ) {
			Signal.POOL.release( node )
			node.listener.__signalNode = null
			node = node.next
		}
		this.listeners = null

		this.listenersOnce = null
	}

	removeAll() {
		let node = this.listeners.root
		while ( node ) {
			Signal.POOL.release( node )
			node.listener.__signalNode = null
			node = node.next
		}
		this.listeners.reset()

		this.listenersOnce = []
	}
}
