export default async function AllAdmins(req, res){

    try {
        
        if(req.body?.userDetails?.userDesignation !== 'Director')
            return res.status(200).json({message : 'warning! you are not allowed to access this route.'});
        res.status(200).json({message : all admins,
                                
                            })
        
    } catch (error) {
        console.log(error)
    }
}