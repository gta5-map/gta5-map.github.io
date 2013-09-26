$(function() {

	window.isTourMode = false;

	if (window.location.hash == '#tour') {
		$('body').addClass('tour');
		window.isTourMode = true;
	}
	else {
		$('body').removeClass('tour');
		window.isTourMode = false;
		// $('#map').css({position:'absolute'});
	}

	$(window).on('hashchange', function() {
		if (window.location.hash == '#tour') {
			$('body').addClass('tour');
			$('#map').css({position:'relative'});
			window.isTourMode = true;
			var x = locations.findWhere({ type: 'Nuclear Waste' }); 
			Vent.trigger('location:clicked', x, true);
		}
		else {
			$('body').removeClass('tour');	
			$('#map').css({position:'absolute'});
			window.isTourMode = false;
		}
	})

	var timestampToSeconds = function(stamp) {
		stamp = stamp.split(':');
		return (parseInt(stamp[0], 10) * 60) + parseInt(stamp[1], 10);
	};

	Handlebars.registerHelper('timestampToSeconds', timestampToSeconds);

	var Vent = _.extend({}, Backbone.Events);

	var LocationModel = Backbone.Model.extend({
		initialize: function() {
			var marker = new google.maps.Marker({
				position: new google.maps.LatLng(this.get('lat'), this.get('lng')),
				icon: {
					url: 'icons/'+categories.getIcon(this.get('type')),
					scaledSize: new google.maps.Size(22, 22),
				}
			});

			_.bindAll(this, 'markerClicked');
			google.maps.event.addListener(marker, 'click', this.markerClicked);

			this.set({ marker: marker });
		},

		markerClicked: function() {
			Vent.trigger('location:clicked', this);
		}
	});
	var LocationsCollection = Backbone.Collection.extend({
		model: LocationModel,
		url: 'locations.json'
	});

	var locations = window.locations = new LocationsCollection();

	var CategoryModel = Backbone.Model.extend({ });
	var CategoriesCollection = Backbone.Collection.extend({

		model: CategoryModel,

		getIcon: function(type) {
			var o = this.findWhere({ name: type });
			if (o) {
				return o.get('icon');
			}
		},

		forView: function(type) {
			var g = this.groupBy('type');
			return _(g).map(function(categories, type) {
				return {
					name: type,
					types: _.map(categories, function(category) { return category.toJSON(); })
				}
			});
		}

	});

	var categories = window.cats = new CategoriesCollection([
		{
			name: 'Nuclear Waste',
			icon: 'collectable/nuclear-waste.png',
			type: 'Collectables',
			enabled: true
		},
		{
			name: 'Spaceship Part',
			icon: 'collectable/spaceship-part.png',
			type: 'Collectables'
		},
		{
			name: 'Stunt Jump',
			icon: 'collectable/stunt-jump.png',
			type: 'Collectables'
		},
		{
			name: 'Letter Scrap',
			icon: 'collectable/letter-scrap.png',
			type: 'Collectables'
		},
		{
			name: 'Money',
			icon: 'collectable/money.png',
			type: 'Collectables'
		}
	]);

	var CategoriesView = Backbone.View.extend({

		initialize: function() {
			this.template = Handlebars.compile($('#categoriesTemplate').html());
		},

		render: function() {
			this.$el.html(this.template({
				categories: categories.forView()
			}));
			return this;
		},

		events: {
			'change input': 'toggleLocations'
		},

		toggleLocations: function(e) {
			var $e = $(e.currentTarget),
				type = $e.val(),
				showLocations = $e.is(':checked'),
				models = locations.where({ type: type });

			if (showLocations) {
				Vent.trigger('locations:visible', models);
			}
			else {
				Vent.trigger('locations:invisible', models);
			}
		}

	});

	var MapView = Backbone.View.extend({

		initialize: function() {
			this.mapType = 'Road';
			this.mapDetails = { 'Atlas': '#0fa8d2', 'Satellite': '#143d6b', 'Road': '#1862ad' };
			this.mapOptions = {
				center: new google.maps.LatLng(66, -125),
				zoom: 4,
				disableDefaultUI: true,
				mapTypeControl: true,
				mapTypeControlOptions: { mapTypeIds: _.keys(this.mapDetails) },
				mapTypeId: this.mapType
			};

			_.bindAll(this, 'getTileImage', 'updateMapBackground');

			this.popupTemplate = Handlebars.compile($('#markerPopupTemplate2').html());

			this.listenTo(Vent, 'locations:visible', this.showLocations);
			this.listenTo(Vent, 'locations:invisible', this.hideLocations);

			this.listenTo(Vent, 'location:clicked', this.popupLocation);
		},

		render: function() {
			var map = this.map = window.map = new google.maps.Map(this.el, this.mapOptions);

			this.initMapTypes(map, _.keys(this.mapDetails));

			google.maps.event.addListener(map, 'maptypeid_changed', this.updateMapBackground);

			google.maps.event.addDomListener(map, 'tilesloaded', function() {
				if ($('#mapControlWrap').length == 0) {
					$('div.gmnoprint').last().wrap('<div id="mapControlWrap" />');
				}
			});

			window.locs = [];
			google.maps.event.addListener(map, 'rightclick', function(e) {
				var marker = new google.maps.Marker({
					map: map,
					moveable: true,
					draggable: true,
					position: e.latLng
				});
				window.locs.push(marker);
			});

			return this;
		},

		getMap: function() {
			return this.map;
		},

		initMapTypes: function(map, types) {
			_.each(types, function(type) {
				var mapTypeOptions = {
					maxZoom: 7,
					minZoom: 3,
					name: type,
					tileSize: new google.maps.Size(256, 256),
					getTileUrl: this.getTileImage
				};
				map.mapTypes.set(type, new google.maps.ImageMapType(mapTypeOptions));
			}, this);
		},

		updateMapBackground: function() {
			this.mapType = this.map.getMapTypeId();
			this.$el.css({
				backgroundColor: this.mapDetails[this.mapType]
			});
		},

		getTileImage: function(rawCoordinates, zoomLevel) {
			var coord = this.normalizeCoordinates(rawCoordinates, zoomLevel);
			if ( ! coord) {
				return null;
			}

			return 'tiles/' + this.mapType.toLowerCase() + '/' + zoomLevel + '-' + coord.x + '_' + coord.y + '.png';
		},

		normalizeCoordinates: function(coord, zoom) {
			var y = coord.y;
			var x = coord.x;

			// tile range in one direction range is dependent on zoom level
			// 0 = 1 tile, 1 = 2 tiles, 2 = 4 tiles, 3 = 8 tiles, etc
			var tileRange = 1 << zoom;

			// don't repeat across y-axis (vertically)
			if (y < 0 || y >= tileRange) {
				return null;
			}

			// repeat across x-axis
			if (x < 0 || x >= tileRange) {
				x = (x % tileRange + tileRange) % tileRange;
			}

			return {
				x: x,
				y: y
			};
		},

		showLocations: function(locations) {
			_.each(locations, function(location) {
				var marker = location.get('marker');
				if ( ! marker.getMap()) {
					marker.setMap(this.map);
				}
				marker.setVisible(true);
			}, this);
		},

		hideLocations: function(locations) {
			_.each(locations, function(location) {
				location.get('marker').setVisible(false);
			});
		},

		popupLocation: function(location, panTo) {
				debugger;
			if (window.isTourMode) {
				$('#tour-info').html(this.popupTemplate(location.toJSON()));
				var n = locations.at(locations.indexOf(location) + 1);
				if (n) {
					$('#tour-next').text(n.get('title'));
				}
				var p = locations.at(locations.indexOf(location) - 1);
				if (p) {
					$('#tour-prev').text(p.get('title'));
				}

				if (panTo) {
					this.map.panTo(location.get('marker').getPosition());
					this.map.setZoom(5);
				}
			}
			else {
				var infoWindow = new google.maps.InfoWindow({
					content: this.popupTemplate(location.toJSON())
				});
				infoWindow.open(this.map, location.get('marker'));

				if (this.currentInfoWindow) {
					this.currentInfoWindow.close();
				}
				this.currentInfoWindow = infoWindow;
			}
		}

	});

	var mapView = new MapView({
		el: '#map'
	});


	var categoriesView = new CategoriesView({
		el: '#types',
		map: mapView.getMap()
	});

	locations.fetch().done(function() {
		mapView.render();
		categoriesView.render();

		categories.chain()
				  .filter(function(c) { return c.get('enabled'); })
				  .map(function(c) { return c.get('name'); })
				  .map(function(name) {
				  	return locations.where({ type: name })
				  })
				  .each(function(locs) {
				  	Vent.trigger('locations:visible', locs);
				  })
				  .value();
	});

	$('#tour-prev, #tour-next').click(function(e) {
		e.preventDefault();
		var navTo = $(this).text();
		var x = locations.findWhere({ title: navTo });
		if (x) Vent.trigger('location:clicked', x, true);
	});

});