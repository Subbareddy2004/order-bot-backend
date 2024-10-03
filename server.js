const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const geolib = require('geolib');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./ecub-v2-firebase-adminsdk-zsyka-dd83a2aad5.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            throw new Error('Message is required');
        }

        // Generate response using Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(message);
        const aiResponse = result.response.text();
        console.log("Gemini response:", aiResponse);

        // Fetch menu items from Firestore
        const menuSnapshot = await db.collection('fs_food_items').get();
        const menu = menuSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Process personalized recommendations
        const recommendations = await getPersonalizedRecommendations(message, menu);

        res.json({
            response: aiResponse,
            recommendations: recommendations
        });
    } catch (error) {
        console.error("Error processing chat:", error);
        res.status(500).json({ 
            error: "An error occurred while processing the chat.",
            details: error.message
        });
    }
});

async function getPersonalizedRecommendations(query, menu, mealType) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        let prompt = `Given the following menu items: ${JSON.stringify(menu)}, `;
        
        if (mealType) {
            prompt += `provide a list of 5 recommended ${mealType} items. `;
        } else if (query) {
            prompt += `and the user's search query: "${query}", provide a list of 5 recommended items. `;
        } else {
            prompt += `provide a list of 5 generally recommended items. `;
        }
        
        prompt += `If the query matches a specific item or category, prioritize those items. Format the response as a JSON array of objects with 'id' and 'relevance' properties, where 'relevance' is a number from 0 to 1 indicating how closely the item matches the query or meal type.`;

        const result = await model.generateContent(prompt);
        const content = result.response.text();
        console.log("Raw Gemini response for recommendations:", content);

        let recommendedItems;
        try {
            // First, try to parse the content directly as JSON
            recommendedItems = JSON.parse(content);
        } catch (error) {
            // If direct parsing fails, try to extract JSON from markdown
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                recommendedItems = JSON.parse(jsonMatch[1]);
            } else {
                throw new Error("Failed to extract JSON from Gemini response");
            }
        }

        // Sort items by relevance
        recommendedItems.sort((a, b) => b.relevance - a.relevance);

        // Get full menu items for the recommended IDs
        const recommendations = recommendedItems.map(item => 
            menu.find(menuItem => menuItem.id === item.id)
        ).filter(Boolean);

        return recommendations;
    } catch (error) {
        console.error("Error getting personalized recommendations:", error);
        return [];
    }
}

app.get('/api/recommendations', async (req, res) => {
    try {
        // Implement logic to fetch recommendations from Firestore
        const recommendationsSnapshot = await db.collection('recommendations').limit(5).get();
        const recommendations = recommendationsSnapshot.docs.map(doc => doc.data());
        res.json(recommendations);
    } catch (error) {
        console.error("Error fetching recommendations:", error);
        res.status(500).json({ error: "Failed to fetch recommendations" });
    }
});

app.get('/api/popular-items', async (req, res) => {
    try {
        const popularItemsSnapshot = await db.collection('fs_food_items')
        .where('productRating', '>=', 4.0)
            .orderBy('productRating', 'desc')
            .limit(5)
            .get();
        const popularItems = popularItemsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        res.json(popularItems);
    } catch (error) {
        console.error("Error fetching popular items:", error);
        res.status(500).json({ error: "Failed to fetch popular items" });
    }
});

app.get('/api/personalized-recommendations', async (req, res) => {
    try {
        const { query, mealType } = req.query;
        const menuSnapshot = await db.collection('fs_food_items').get();
        const menu = menuSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const recommendations = await getPersonalizedRecommendations(query, menu, mealType);
        res.json(recommendations);
    } catch (error) {
        console.error("Error fetching personalized recommendations:", error);
        res.status(500).json({ error: "Failed to fetch personalized recommendations" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});