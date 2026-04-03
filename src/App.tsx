import React, { useEffect, useState, useRef } from 'react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

declare global {
  interface Window {
    initMap: () => void;
    google: any;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Welcome to Wayfinder! I am your AI Concierge. How can I help you navigate today?', sender: 'ai' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const mapRef = useRef<any>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize Map
  useEffect(() => {
    window.initMap = async () => {
      const center = { lat: 37.329, lng: -121.888 };
      const mapOptions = {
        zoom: 18,
        center: center,
        mapId: 'DEMO_MAP_ID', // Optional: for advanced styling
        disableDefaultUI: false,
        styles: [
          {
            featureType: "poi",
            elementType: "labels",
            stylers: [{ visibility: "off" }]
          }
        ]
      };
      
      if (window.google) {
        const map = new window.google.maps.Map(document.getElementById('map'), mapOptions);
        mapRef.current = map;
        
        // Add a marker for the museum
        new window.google.maps.Marker({
          position: center,
          map: map,
          title: "Wayfinder Main Entrance"
        });

        // --- Fetch and Load Spanner Data ---
        try {
          const response = await fetch('/api/map-nodes');
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch map nodes');
          }
          const data = await response.json();
          
          // Add GeoJSON data to map
          map.data.addGeoJson(data);

          // Fit map to bounds of the features
          const bounds = new window.google.maps.LatLngBounds();
          map.data.forEach((feature: any) => {
            const geometry = feature.getGeometry();
            if (geometry.getType() === 'Point') {
              bounds.extend(geometry.get());
            } else {
              geometry.forEachLatLng((latLng: any) => {
                bounds.extend(latLng);
              });
            }
          });
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds);
          }

          // If mock data is used, notify the user
          if (data.source === 'mock') {
            setMessages(prev => {
              // Check if the warning already exists to avoid duplicates
              if (prev.some(m => m.id === 'mock-warning-static')) return prev;
              
              let warningText = '💡 Note: Using mock map data for this preview because the live Spanner API is restricted in this environment.';
              if (data.isApiDisabled && data.enableApiUrl) {
                warningText = `⚠️ Spanner API is disabled. Please enable it here: ${data.enableApiUrl}`;
              }

              return [...prev, {
                id: 'mock-warning-static',
                text: warningText,
                sender: 'ai'
              }];
            });
          }
          
          // Style the GeoJSON features
          map.data.setStyle((feature: any) => {
            const category = feature.getProperty('category');
            const nodeType = feature.getProperty('node_type');
            const sourceFile = feature.getProperty('source_file');
            
            let color = '#007aff'; // Default blue
            let weight = 1;
            let opacity = 0.2;
            let visible = true;

            // Styling based on category/type
            if (category === 'room') { color = '#ff9500'; opacity = 0.4; }
            else if (category === 'walkway') { color = '#f2f2f7'; opacity = 0.6; }
            else if (category === 'stairs' || category === 'steps') { color = '#5856d6'; opacity = 0.5; }
            else if (category === 'elevator') { color = '#af52de'; opacity = 0.6; }
            else if (category === 'escalator') { color = '#ff2d55'; opacity = 0.6; }
            else if (category === 'restroom.male' || category === 'restroom.female' || category === 'restroom') { color = '#34c759'; opacity = 0.5; }
            else if (category === 'parking') { color = '#8e8e93'; opacity = 0.3; }
            else if (category === 'nonpublic') { color = '#c7c7cc'; opacity = 0.2; }
            else if (category === 'opentobelow') { color = '#ffffff'; opacity = 0.1; }
            
            // Styling based on source file
            if (sourceFile === 'venue.geojson') {
              color = '#000000';
              weight = 2;
              opacity = 0.05;
            } else if (sourceFile === 'footprint.geojson') {
              color = '#333333';
              weight = 1;
              opacity = 0.1;
            } else if (sourceFile === 'opening.geojson') {
              color = '#ff3b30';
              weight = 3;
              opacity = 1;
            }

            return {
              fillColor: color,
              strokeColor: color,
              strokeWeight: weight,
              fillOpacity: opacity,
              visible: visible,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 4,
                fillColor: color,
                fillOpacity: 0.8,
                strokeWeight: 1
              }
            };
          });

          // Show info window on click
          const infoWindow = new window.google.maps.InfoWindow();
          map.data.addListener('click', (event: any) => {
            const properties = event.feature.getProperties ? event.feature.getProperties() : {};
            const name = properties.name?.en || properties.name || 'Unnamed Space';
            const category = properties.category || 'No Category';
            const nodeType = properties.node_type || 'No Type';
            const sourceFile = properties.source_file || 'Unknown';
            
            infoWindow.setContent(`
              <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 250px;">
                <h3 style="margin: 0 0 4px 0; font-size: 16px; color: #1c1c1e; font-weight: 600;">${name}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                  <span style="background: #e5e5ea; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #3a3a3c; font-weight: 500;">${category}</span>
                  <span style="background: #f2f2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #8e8e93;">${nodeType}</span>
                </div>
                <div style="font-size: 13px; color: #3a3a3c; margin-bottom: 4px;">
                  <strong>Source:</strong> ${sourceFile}
                </div>
                <div style="font-size: 12px; color: #8e8e93; margin-top: 8px; border-top: 1px solid #e5e5ea; padding-top: 8px;">
                  ID: ${event.feature.getId() || 'N/A'}
                </div>
              </div>
            `);
            infoWindow.setPosition(event.latLng);
            infoWindow.open(map);
          });

        } catch (error: any) {
          console.error("Error loading map nodes:", error);
          // Update the UI to show the specific error if the API is disabled
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: `⚠️ Error loading map data: ${error.message}. Please ensure the Spanner API is enabled in your Google Cloud project.`,
            sender: 'ai'
          }]);
        }
      }
    };

    // If script already loaded, call initMap
    if (window.google && window.google.maps) {
      window.initMap();
    }
  }, []);

  const handleChatSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user'
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    // Simulate AI Response
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "I'm calculating the best route to the T-Rex exhibit for you. Please follow the red line on the map.",
        sender: 'ai'
      };
      setMessages(prev => [...prev, aiMessage]);
      
      // Draw a sample route line
      drawRouteLine([
        { lat: 37.329, lng: -121.888 },
        { lat: 37.3295, lng: -121.8885 },
        { lat: 37.330, lng: -121.888 }
      ]);
    }, 1000);
  };

  const drawRouteLine = (coordinates: { lat: number; lng: number }[]) => {
    if (!window.google || !mapRef.current) return;

    const routePath = new window.google.maps.Polyline({
      path: coordinates,
      geodesic: true,
      strokeColor: '#FF0000',
      strokeOpacity: 1.0,
      strokeWeight: 4,
    });

    routePath.setMap(mapRef.current);
    
    // Auto-center on the route
    const bounds = new window.google.maps.LatLngBounds();
    coordinates.forEach(coord => bounds.extend(coord));
    mapRef.current.fitBounds(bounds);
  };

  return (
    <div className="app-container">
      {/* Left Panel: Chat UI */}
      <div className="chat-panel">
        <header className="chat-header">
          <h1>Wayfinder</h1>
        </header>
        
        <div className="message-history">
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.sender}`}>
              {msg.text}
            </div>
          ))}
          <div ref={messageEndRef} />
        </div>

        <form className="chat-input-area" onSubmit={handleChatSubmit}>
          <input 
            type="text" 
            placeholder="Ask for directions..." 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button type="submit">Send</button>
        </form>
      </div>

      {/* Right Panel: Map UI */}
      <div className="map-panel">
        <div id="map"></div>
      </div>
    </div>
  );
}
