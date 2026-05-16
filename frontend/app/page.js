'use client';

import { useState, useEffect } from 'react';

// IMPORTANT: Replace this with your actual Cloudflare Worker URL and your custom domain
const WORKER_URL = "https://tempmails.sawyerbobk563.workers.dev/";
const DOMAIN = "yourdomain.com";

export default function Home() {
  const [email, setEmail] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let savedEmail = localStorage.getItem('temp_email');
    if (!savedEmail) {
      const randomString = Math.random().toString(36).substring(2, 10);
      savedEmail = `${randomString}@${DOMAIN}`;
      localStorage.setItem('temp_email', savedEmail);
    }
    setEmail(savedEmail);
    fetchMessages(savedEmail);

    const interval = setInterval(() => {
      fetchMessages(savedEmail);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const fetchMessages = async (currentEmail) => {
    try {
      const res = await fetch(`${WORKER_URL}?email=${currentEmail}`);
      const data = await res.json();
      setMessages(data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-2xl mx-auto p-8">
      <div className="bg-white p-8 rounded-xl shadow-md">
        <h1 className="text-3xl font-bold mb-6 text-gray-800">Your Temporary Email</h1>
        
        <div className="flex gap-4 mb-8">
          <input 
            type="text" 
            readOnly 
            value={email} 
            className="flex-grow border-2 border-gray-200 p-3 rounded-lg bg-gray-50 font-mono text-lg outline-none"
          />
          <button 
            onClick={() => fetchMessages(email)}
            className="bg-black text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Refresh
          </button>
        </div>

        <h2 className="text-xl font-semibold mb-4 text-gray-700">Inbox</h2>
        
        <div className="space-y-4">
          {loading ? (
            <p className="text-gray-500 text-center py-8">Checking for emails...</p>
          ) : messages.length === 0 ? (
            <p className="text-gray-500 text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              No emails received yet. Send a test email to the address above!
            </p>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="border border-gray-200 p-4 rounded-lg bg-gray-50">
                <div className="mb-2">
                  <p className="text-sm text-gray-500">From: <span className="text-gray-800 font-medium">{msg.from}</span></p>
                  <p className="text-sm text-gray-500">Subject: <span className="text-gray-800 font-medium">{msg.subject}</span></p>
                </div>
                <div className="mt-4 text-gray-700 whitespace-pre-wrap bg-white p-4 rounded border border-gray-100">
                  {msg.body}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
