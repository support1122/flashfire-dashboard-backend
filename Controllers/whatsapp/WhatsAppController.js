import axios from 'axios';
import { WhatsAppGroupMappingModel } from '../../Schema_Models/WhatsAppGroupMapping.js';
import { ProfileModel } from '../../Schema_Models/ProfileModel.js';

const WHAPI_API_URL = process.env.WHAPI_API_URL || 'https://gate.whapi.cloud';
const WHAPI_API_TOKEN = process.env.WHAPI_API_TOKEN || '';

const whapiClient = axios.create({
  baseURL: WHAPI_API_URL,
  headers: {
    'Authorization': `Bearer ${WHAPI_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

export const getWhatsAppGroups = async (req, res) => {
  try {
    if (!WHAPI_API_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'WhatsApp API token not configured'
      });
    }

    const response = await whapiClient.get('/groups');
    
    const groups = (response.data.groups || []).map(group => ({
      id: group.id,
      name: group.name || group.subject || 'Unnamed Group',
      participants: group.participants || []
    }));

    res.json({
      success: true,
      message: 'Groups fetched successfully',
      data: groups
    });
  } catch (error) {
    console.error('Error fetching WhatsApp groups:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message
    });
  }
};

export const linkUserToGroup = async (req, res) => {
  try {
    const { userEmail, groupId, groupName, linkedBy } = req.body;

    if (!userEmail || !groupId) {
      return res.status(400).json({
        success: false,
        message: 'User email and group ID are required'
      });
    }

    const mapping = await WhatsAppGroupMappingModel.findOneAndUpdate(
      { userEmail: userEmail.toLowerCase() },
      {
        userEmail: userEmail.toLowerCase(),
        groupId,
        groupName: groupName || '',
        linkedBy: linkedBy || '',
        linkedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'User linked to WhatsApp group successfully',
      data: mapping
    });
  } catch (error) {
    console.error('Error linking user to group:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const getUserGroupMapping = async (req, res) => {
  try {
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: 'User email is required'
      });
    }

    const mapping = await WhatsAppGroupMappingModel.findOne({
      userEmail: userEmail.toLowerCase()
    });

    if (!mapping) {
      return res.json({
        success: true,
        data: null,
        message: 'No group mapping found for this user'
      });
    }

    res.json({
      success: true,
      data: mapping
    });
  } catch (error) {
    console.error('Error fetching user group mapping:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const sendJobCardNotification = async (userEmail, jobCount = 1) => {
  try {
    if (!WHAPI_API_TOKEN) {
      console.log('WhatsApp API token not configured, skipping notification');
      return { success: false, message: 'WhatsApp API not configured' };
    }

    const mapping = await WhatsAppGroupMappingModel.findOne({
      userEmail: userEmail.toLowerCase()
    });

    if (!mapping || !mapping.groupId) {
      console.log(`No WhatsApp group mapping found for user: ${userEmail}`);
      return { success: false, message: 'No group mapping found' };
    }

    const profile = await ProfileModel.findOne({
      email: userEmail.toLowerCase()
    });

    const userName = profile ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() : 'User';
    const displayName = userName || 'User';

    const message = `🎯 Great news ${displayName}! We've added ${jobCount} new job opportunity${jobCount > 1 ? 'ies' : ''} to your dashboard.\n\n📋 Check your Job Tracker to review the details and take action on positions that match your profile.\n\n🔗 Access your dashboard: https://portal.flashfirejobs.com/?tab=jobtracker\n\n✨ We're here to support your career journey!\n\nThank you!`;

    const response = await whapiClient.post('/messages/text', {
      to: mapping.groupId,
      body: message
    });

    console.log(`WhatsApp notification sent successfully to group ${mapping.groupId} for user ${userEmail}`);
    return {
      success: true,
      message: 'Notification sent successfully',
      data: response.data
    };
  } catch (error) {
    console.error('Error sending WhatsApp notification:', error.response?.data || error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message
    };
  }
};

export const sendCustomNotification = async (req, res) => {
  try {
    const { userEmail, message } = req.body;

    if (!userEmail || !message) {
      return res.status(400).json({
        success: false,
        message: 'User email and message are required'
      });
    }

    if (!WHAPI_API_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'WhatsApp API token not configured'
      });
    }

    const mapping = await WhatsAppGroupMappingModel.findOne({
      userEmail: userEmail.toLowerCase()
    });

    if (!mapping || !mapping.groupId) {
      return res.status(404).json({
        success: false,
        message: 'No WhatsApp group mapping found for this user'
      });
    }

    const response = await whapiClient.post('/messages/text', {
      to: mapping.groupId,
      body: message
    });

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: response.data
    });
  } catch (error) {
    console.error('Error sending custom notification:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message
    });
  }
};
