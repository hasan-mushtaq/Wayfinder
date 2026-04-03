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

          // If mock data is used, notify the user
          if (data.source === 'mock') {
            setMessages(prev => [...prev, {
              id: 'mock-warning',
              text: '💡 Note: Using mock map data for this preview because the live Spanner API is restricted in this environment. The live connection will work when deployed to your production project.',
              sender: 'ai'
            }]);
          }
          
          // Style the GeoJSON features
          map.data.setStyle((feature: any) => {
            const category = feature.getProperty('category');
            let color = '#007aff';
            if (category === 'exhibit') color = '#ff3b30';
            if (category === 'facility') color = '#34c759';
            
            return {
              fillColor: color,
              strokeColor: color,
              strokeWeight: 2,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: color,
                fillOpacity: 0.8,
                strokeWeight: 1
              }
            };
          });

          // Show info window on click
          const infoWindow = new window.google.maps.InfoWindow();
          map.data.addListener('click', (event: any) => {
            const name = event.feature.getProperty('name');
            const category = event.feature.getProperty('category');
            infoWindow.setContent(`
              <div style="padding: 8px;">
                <h3 style="margin: 0 0 4px 0; font-size: 14px;">${name}</h3>
                <p style="margin: 0; font-size: 12px; color: #666;">Category: ${category}</p>
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
