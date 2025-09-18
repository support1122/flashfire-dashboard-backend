export const ReciveData = (req, res) => {
     try {
          const { content, websiteUrl, selectedUsers, extractedAt } = req.body;

          // Log the received data to the console
          console.log('Received Data:');
          console.log('Content:', content);
          console.log('Website URL:', websiteUrl);
          console.log('Selected Users:', selectedUsers);
          console.log('Extracted At:', extractedAt);

          // Send a success response
          return res.status(200).json({
               success: true,
               message: 'Data received successfully',
          });
     } catch (error) {
          console.error('Error receiving data:', error);
          return res.status(500).json({ success: false, message: 'Internal server error' });
     }
};