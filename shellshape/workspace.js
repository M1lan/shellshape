const Mainloop = imports.mainloop;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Log = imports.log4javascript.log4javascript;

function Workspace() {
	this._init.apply(this, arguments)
}
Workspace.prototype = {
	_init : function(meta_workspace, layout, ext) {
		this.log = Log.getLogger("shellshape.workspace");
		this.auto_tile = false;
		this.meta_workspace = meta_workspace;
		this.layout = layout;
		this.extension = ext;
		this.extension._connect(this, this.meta_workspace, 'window-added', Lang.bind(this, this.on_window_create));
		this.extension._connect(this, this.meta_workspace, 'window-removed', Lang.bind(this, this.on_window_remove));
		this.meta_windows().map(Lang.bind(this, this.on_window_create));
	},
	_disable: function() {
		this.meta_windows().map(Lang.bind(this, this.on_window_remove));
		this.extension._disconnect_signals(this);
		this.meta_workspace = null;
		this.extension = null;
	},

	tile_all : function(new_flag) {
		if(typeof(new_flag) === 'undefined') {
			new_flag = !this.auto_tile;
		}
		this.auto_tile = new_flag;
		this.meta_windows().map(Lang.bind(this, function(meta_window) {
			var win = this.extension.get_window(meta_window);
			if(this.auto_tile && win.should_auto_tile()) {
				this.layout.tile(win);
			} else {
				this.layout.untile(win);
			}
		}));
	},

	on_window_create: function(meta_window) {
		var get_actor = Lang.bind(this, function() {
			try {
				return meta_window.get_compositor_private();
			} catch (e) {
				this.log.warn("couldn't call get_compositor_private for window " + meta_window, e);
				if(meta_window.get_compositor_private) {
					this.log.error("But the function exists! aborting...");
					throw(e);
				}
			}
			return null;
		});
		let actor = get_actor();
		if (!actor) {
			// Newly-created windows are added to a workspace before
			// the compositor finds out about them...
			Mainloop.idle_add(Lang.bind(this, function () {
				if (get_actor() && meta_window.get_workspace() == this.meta_workspace) {
					this.on_window_create(meta_window);
				}
				return false;
			}));
			return;
		}

		var win = this.extension.get_window(meta_window);
		if(!win.can_be_tiled()) {
			return;
		}
		this.log.debug("on_window_create for " + win);
		this.layout.add(win, this.extension.focus_window);
		// terribly unobvious name for "this MetaWindow's associated MetaWindowActor"
		win.workspace_signals = [];

		let bind_to_window_change = Lang.bind(this, function(event_name, relevant_grabs, cb) {
			// we only care about events *after* at least one relevant grab_op,
			// this flag keeps track of that
			let change_pending = false;
			let signal_handler = Lang.bind(this, function() {
				let grab_op = global.screen.get_display().get_grab_op();
				if(relevant_grabs.indexOf(grab_op) != -1) {
					//wait for the operation to end...
					change_pending = true;
					Mainloop.idle_add(signal_handler);
				} else {
					let change_happened = change_pending;
					// it's critical that this flag be reset before cb() happens, otherwise the
					// callback will (frequently) trigger a stream of feedback events.
					change_pending = false;
					if(grab_op == Meta.GrabOp.NONE && change_happened) {
						this.log.debug("change event [" + event_name + "] happened for window " + win);
						cb(win);
					}
				}
				return false;
			});
			win.workspace_signals.push([actor, actor.connect(event_name + '-changed', signal_handler)]);
		});


		let move_ops = [Meta.GrabOp.MOVING];
		let resize_ops = [
				Meta.GrabOp.RESIZING_SE,
				Meta.GrabOp.RESIZING_S,
				Meta.GrabOp.RESIZING_SW,
				Meta.GrabOp.RESIZING_N,
				Meta.GrabOp.RESIZING_NE,
				Meta.GrabOp.RESIZING_NW,
				Meta.GrabOp.RESIZING_W,
				Meta.GrabOp.RESIZING_E
		];
		bind_to_window_change('position', move_ops,     Lang.bind(this.layout, this.layout.on_window_moved));
		bind_to_window_change('size',     resize_ops,   Lang.bind(this.layout, this.layout.on_window_resized));
		win.workspace_signals.push([meta_window, meta_window.connect('notify::minimized', Lang.bind(this, this.on_window_minimize_changed))]);

		if(this.auto_tile && win.should_auto_tile()) {
			this.layout.tile(win);
		}
	},

	on_window_minimize_changed: function(meta_window) {
		this.log.debug("window minimization state changed for window " + meta_window);
		this.layout.layout();
	},

	on_window_remove: function(meta_window) {
		let window = this.extension.get_window(meta_window);
		this.log.debug("on_window_remove for " + window);
		if(window.workspace_signals !== undefined) {
			this.log.debug("Disconnecting " + window.workspace_signals.length + " workspace-managed signals from window");
			window.workspace_signals.map(Lang.bind(this, function(signal) {
				this.log.debug("Signal is " + signal + ", disconnecting from " + signal[0]);
				signal[0].disconnect(signal[1]);
			}));
		}
		this.layout.on_window_killed(window);
		this.extension.remove_window(meta_window);
	},

	meta_windows: function() {
		var wins = this.meta_workspace.list_windows();
		return wins;
	}
}
