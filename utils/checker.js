// utils/checker.js
import axios from 'axios';

export async function checkChatStatus(link) {
    try {
        const response = await axios.get(link);
        // Axios response object has data, status, headers etc.
        // For a simple status check, you might just care if it succeeded.
        if (response.status === 200) {
            return `Status for ${link}: ✅ Online`;
        } else {
            return `Status for ${link}: ⚠️ HTTP Status ${response.status}`;
        }
    } catch (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            return `Status for ${link}: ❌ Offline (HTTP ${error.response.status} - ${error.response.statusText})`;
        } else if (error.request) {
            // The request was made but no response was received
            return `Status for ${link}: ❌ Offline (No response from server)`;
        } else {
            // Something happened in setting up the request that triggered an Error
            return `Status for ${link}: ❌ Error - ${error.message}`;
        }
    }
}
