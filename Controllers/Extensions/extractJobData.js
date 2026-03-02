export const extractJobData = async (req, res) => {
    try {
        const { content, websiteUrl } = req.body;

        if (!content || typeof content !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Content is required and must be a string'
            });
        }

        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            console.error('OPENAI_API_KEY is not configured in environment variables');
            return res.status(500).json({
                success: false,
                message: 'OpenAI API key is not configured'
            });
        }

        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const openaiUrl = 'https://api.openai.com/v1/chat/completions';

        const prompt = `Extract the following information from this job posting text. Return ONLY a valid JSON object with these exact fields: {"company": "company name", "position": "job title/role", "description": "full job description"}. 

If any information is missing, use "Unknown" for company/position and empty string "" for description.

Job posting text:
${content.substring(0, 15000)}`;

        const response = await fetch(openaiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: openaiModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a job data extraction assistant. Extract company name, job position, and job description from job posting text. Always return valid JSON only.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('OpenAI API error:', errorData);
            return res.status(response.status).json({
                success: false,
                message: errorData.error?.message || `OpenAI API error: ${response.status}`,
                error: errorData
            });
        }

        const data = await response.json();
        const contentText = data.choices?.[0]?.message?.content?.trim() || '{}';

        let extractedData;
        try {
            extractedData = JSON.parse(contentText);
        } catch (parseError) {
            const jsonMatch = contentText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                extractedData = JSON.parse(jsonMatch[0]);
            } else {
                console.error('Failed to parse OpenAI response:', contentText);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to parse OpenAI response as JSON'
                });
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                company: extractedData.company || 'Unknown',
                position: extractedData.position || 'Unknown',
                description: extractedData.description || '',
                url: (websiteUrl && typeof websiteUrl === 'string') ? websiteUrl.trim() : ''
            }
        });

    } catch (error) {
        console.error('Error in extractJobData:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

