// Simple debug for invalid-event issue
// Run this in browser console on http://localhost:5174/

console.clear();
console.log('🔍 Debugging invalid-event issue...');

// 1. Check localStorage
const sk = localStorage.getItem('nostr_sk');
console.log('Private key exists:', !!sk);
console.log('Private key length:', sk?.length);
console.log('Private key is valid hex:', /^[0-9a-f]{64}$/i.test(sk || ''));

if (!sk) {
  console.error('❌ No private key found in localStorage');
  console.log('💡 Try creating a new identity in the app');
} else {
  console.log('✅ Private key found');
  
  // 2. Test with manual event creation
  (async () => {
    try {
      // Import nostr-tools
      const { getPublicKey, finalizeEvent } = window.NostrTools || await import('nostr-tools');
      
      // Convert hex to bytes manually
      const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      
      const skBytes = hexToBytes(sk);
      const pk = getPublicKey(skBytes);
      
      console.log('✅ Public key generated:', pk.slice(0, 16) + '...');
      
      // Create a simple test event
      const template = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Test message from debug',
        tags: []
      };
      
      const event = finalizeEvent(template, skBytes);
      console.log('✅ Event created:', {
        id: event.id?.slice(0, 16) + '...',
        pubkey: event.pubkey?.slice(0, 16) + '...',
        sig_length: event.sig?.length,
        kind: event.kind,
        content: event.content
      });
      
      // Validate event structure
      const required = ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'];
      const missing = required.filter(field => !(field in event));
      
      if (missing.length > 0) {
        console.error('❌ Event missing required fields:', missing);
      } else {
        console.log('✅ Event has all required fields');
      }
      
      // Check specific validation issues
      if (event.pubkey !== pk) {
        console.error('❌ Public key mismatch!');
        console.log('  Generated PK:', pk);
        console.log('  Event PK:', event.pubkey);
      }
      
      if (!event.id || event.id.length !== 64) {
        console.error('❌ Invalid event ID:', event.id);
      }
      
      if (!event.sig || event.sig.length !== 128) {
        console.error('❌ Invalid signature length:', event.sig?.length);
      }
      
      // Test relay communication
      console.log('🌐 Testing relay connection...');
      const relayUrl = 'wss://relay1.matrus.org';
      
      try {
        const ws = new WebSocket(relayUrl);
        
        ws.onopen = () => {
          console.log('✅ Relay connected:', relayUrl);
          
          // Send the test event
          const eventMessage = JSON.stringify(['EVENT', event]);
          ws.send(eventMessage);
          console.log('📤 Event sent to relay');
        };
        
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            console.log('📥 Relay response:', data);
            
            if (data[0] === 'OK' && data[1] === event.id) {
              const success = data[2];
              const reason = data[3];
              
              if (success) {
                console.log('✅ Event accepted by relay');
              } else {
                console.error('❌ Event rejected by relay:', reason);
                
                // Check for common rejection reasons
                if (reason?.includes('invalid')) {
                  console.log('💡 Event validation failed on relay side');
                }
                if (reason?.includes('duplicate')) {
                  console.log('💡 Event was duplicate');
                }
                if (reason?.includes('rate')) {
                  console.log('💡 Rate limited');
                }
              }
            }
            
            if (data[0] === 'NOTICE') {
              console.log('📢 Relay notice:', data[1]);
            }
          } catch (e) {
            console.log('📥 Raw relay message:', msg.data);
          }
        };
        
        ws.onerror = (error) => {
          console.error('❌ Relay connection error:', error);
        };
        
        ws.onclose = () => {
          console.log('🔌 Relay connection closed');
        };
        
        // Close after 10 seconds
        setTimeout(() => {
          ws.close();
        }, 10000);
        
      } catch (error) {
        console.error('❌ Failed to connect to relay:', error);
      }
      
    } catch (error) {
      console.error('❌ Debug test failed:', error);
    }
  })();
}

// Also check app state
setTimeout(() => {
  try {
    // Check if app is loaded and has stores
    if (window.location.pathname === '/') {
      console.log('🔍 Checking app state...');
      
      // Look for Zustand stores in window or check if available
      console.log('Current URL:', window.location.href);
      console.log('Local storage keys:', Object.keys(localStorage));
      
      // Check if there are any global error handlers catching issues
      const originalError = window.onerror;
      window.onerror = (msg, file, line, col, error) => {
        if (msg?.toString().includes('invalid') || error?.message?.includes('invalid')) {
          console.error('🚨 Global error caught (might be related):', {msg, file, line, error});
        }
        if (originalError) originalError(msg, file, line, col, error);
      };
    }
  } catch (e) {
    console.log('App state check failed:', e);
  }
}, 2000);

console.log('🔍 Debug script loaded. Check console for results...');
